// src/server/server.ts — Express app factory for the Haystack Lab API

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import type { Pipeline } from "../engine/pipeline.js";
import type { Scenario } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { createScenarioFromHour } from "../engine/scenario.js";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

export interface CreateAppConfig {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  outputDir: string;
}

export function createApp(config: CreateAppConfig): Express {
  const { pipeline, weatherProvider, outputDir } = config;
  const app = express();

  app.use(express.json());

  // Serve Lab UI production build (if it exists)
  const labUiDist = path.resolve("lab-ui/dist");
  if (fs.existsSync(labUiDist)) {
    app.use(express.static(labUiDist));
  }

  // Multer: disk storage into os.tmpdir(), 20 MB limit
  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
    }),
    limits: { fileSize: MAX_IMAGE_SIZE },
  });

  // --- POST /api/generate ---
  app.post(
    "/api/generate",
    upload.single("image"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "No image provided" });
          return;
        }

        const tempFilePath = req.file.path;

        try {
          // Determine hour
          const hour =
            req.body.hour !== undefined
              ? parseInt(req.body.hour, 10)
              : new Date().getHours();

          // Build scenario
          const scenario = await buildScenario(
            hour,
            req.body,
            weatherProvider,
          );

          // Normalize promptOverride: treat empty/whitespace-only as undefined
          const promptOverride = req.body.promptOverride?.trim() || undefined;

          const result = await pipeline.generate(
            tempFilePath,
            scenario,
            promptOverride,
          );

          res.json({
            metadata: result.metadata,
            imageUrl: `/api/outputs/${result.metadata.id}`,
          });
        } finally {
          // Clean up temp file
          try {
            fs.unlinkSync(tempFilePath);
          } catch {
            // Best-effort cleanup
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Generation failed";
        console.error(
          `[${new Date().toISOString()}] Generate error: ${message}`,
        );
        res.status(500).json({ error: message });
      }
    },
  );

  // --- GET /api/history ---
  app.get("/api/history", (req: Request, res: Response) => {
    try {
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 24;

      const allRenders = pipeline.getStore().listAll();
      const renders = allRenders.slice(0, limit).map((meta) => ({
        ...meta,
        imageUrl: `/api/outputs/${meta.id}`,
      }));

      res.json({ renders });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to list history";
      console.error(
        `[${new Date().toISOString()}] History error: ${message}`,
      );
      res.status(500).json({ error: message });
    }
  });

  // --- GET /api/outputs/:id ---
  app.get("/api/outputs/:id", (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      // Validate ID to prevent directory traversal
      if (!VALID_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "Invalid output ID" });
        return;
      }

      const imagePath = path.join(outputDir, `${id}.png`);
      if (!fs.existsSync(imagePath)) {
        res.status(404).json({ error: "Output not found" });
        return;
      }

      res.sendFile(imagePath, { headers: { "Content-Type": "image/png" } });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to serve output";
      console.error(
        `[${new Date().toISOString()}] Output error: ${message}`,
      );
      res.status(500).json({ error: message });
    }
  });

  // --- POST /api/location/search ---
  app.post(
    "/api/location/search",
    async (req: Request, res: Response) => {
      try {
        const { query } = req.body;

        if (!query || typeof query !== "string") {
          res.status(400).json({ error: "Query is required" });
          return;
        }

        const locations = await weatherProvider.searchLocations(query);
        res.json({ locations });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Location search failed";
        console.error(
          `[${new Date().toISOString()}] Location search error: ${message}`,
        );
        res.status(500).json({ error: message });
      }
    },
  );

  // --- GET /api/weather ---
  app.get("/api/weather", async (req: Request, res: Response) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      const timezone = req.query.timezone as string;

      if (isNaN(lat) || isNaN(lon) || !timezone) {
        res.status(400).json({ error: "lat, lon, and timezone are required" });
        return;
      }

      const [current, hourly] = await Promise.all([
        weatherProvider.getCurrentConditions(lat, lon, timezone),
        weatherProvider.getHourlyConditions(lat, lon, timezone),
      ]);

      res.json({ current, hourly });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Weather fetch failed";
      console.error(
        `[${new Date().toISOString()}] Weather error: ${message}`,
      );
      res.status(500).json({ error: message });
    }
  });

  return app;
}

/**
 * Build a Scenario from request body fields + optional weather fetch.
 *
 * Priority:
 * 1. If explicit weather overrides provided (weatherCode, etc.) → use those
 * 2. If lat/lon/timezone provided → fetch from weather provider for the given hour
 * 3. Otherwise → time-only scenario
 */
async function buildScenario(
  hour: number,
  body: Record<string, string | undefined>,
  weatherProvider: WeatherProvider,
): Promise<Scenario> {
  const scenario = createScenarioFromHour(
    hour,
    body.isDay !== undefined ? body.isDay === "true" : undefined,
  );

  const hasExplicitWeather =
    body.weatherCode !== undefined ||
    body.cloudPercent !== undefined ||
    body.precipProbability !== undefined;

  if (hasExplicitWeather) {
    // Use explicit overrides
    if (body.weatherCode !== undefined) {
      scenario.weatherCode = parseInt(body.weatherCode, 10);
    }
    if (body.cloudPercent !== undefined) {
      scenario.cloudPercent = parseInt(body.cloudPercent, 10);
    }
    if (body.precipProbability !== undefined) {
      scenario.precipPercent = parseInt(body.precipProbability, 10);
    }
    return scenario;
  }

  const lat = body.lat ? parseFloat(body.lat) : undefined;
  const lon = body.lon ? parseFloat(body.lon) : undefined;
  const timezone = body.timezone;

  if (lat !== undefined && lon !== undefined && timezone) {
    // Fetch weather from provider
    try {
      const hourly = await weatherProvider.getHourlyConditions(
        lat,
        lon,
        timezone,
      );

      // Find the slot matching the requested hour
      const slot = hourly.find((h) => {
        const slotHour = parseInt(h.time.split("T")[1].split(":")[0], 10);
        return slotHour === hour;
      });

      if (slot) {
        scenario.weatherCode = slot.weatherCode;
        scenario.cloudPercent = slot.cloudPercent;
        scenario.precipPercent = slot.precipProbability;
        scenario.isDay = slot.isDay;
      }
    } catch (err) {
      // Weather fetch failed — fall back to time-only scenario
      console.error(
        `[${new Date().toISOString()}] Weather fetch failed during generate, using time-only scenario: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return scenario;
}
