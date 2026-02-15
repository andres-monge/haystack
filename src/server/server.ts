// src/server/server.ts — Express app factory for the Haystack Lab API

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import type { Pipeline } from "../engine/pipeline.js";
import type { WeatherProvider } from "../weather/types.js";
import { createScenarioFromHour, describeScenario } from "../engine/scenario.js";
import { DEFAULT_TEMPLATE } from "../engine/prompt.js";
import { buildScenario, computeSunMoon } from "./scenario-builder.js";

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
          // Determine and validate hour
          const hour =
            req.body.hour !== undefined
              ? parseInt(req.body.hour, 10)
              : new Date().getHours();

          if (isNaN(hour) || hour < 0 || hour > 23) {
            res.status(400).json({ error: "hour must be an integer 0-23" });
            return;
          }

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
          // Clean up temp file (fire-and-forget, non-blocking)
          fs.promises.unlink(tempFilePath).catch(() => {});
        }
      } catch (err) {
        console.error(
          `[${new Date().toISOString()}] Generate error:`,
          err instanceof Error ? err.message : err,
        );
        res.status(500).json({ error: "Generation failed" });
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
      console.error(
        `[${new Date().toISOString()}] History error:`,
        err instanceof Error ? err.message : err,
      );
      res.status(500).json({ error: "Failed to list history" });
    }
  });

  // --- GET /api/outputs/:id ---
  app.get("/api/outputs/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;

    // Validate ID to prevent directory traversal
    if (!VALID_ID_PATTERN.test(id)) {
      res.status(400).json({ error: "Invalid output ID" });
      return;
    }

    const imagePath = path.join(outputDir, `${id}.png`);
    try {
      await fs.promises.access(imagePath);
    } catch {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    const stream = fs.createReadStream(imagePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(404).json({ error: "Output not found" });
      }
    });
    stream.pipe(res);
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
        console.error(
          `[${new Date().toISOString()}] Location search error:`,
          err instanceof Error ? err.message : err,
        );
        res.status(500).json({ error: "Location search failed" });
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

      const forecast = await weatherProvider.getForecast(lat, lon, timezone);

      res.json({ current: forecast.current, hourly: forecast.hourly });
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] Weather error:`,
        err instanceof Error ? err.message : err,
      );
      res.status(500).json({ error: "Weather fetch failed" });
    }
  });

  // --- GET /api/config/default-template ---
  app.get("/api/config/default-template", (_req: Request, res: Response) => {
    res.json({ template: DEFAULT_TEMPLATE });
  });

  // --- POST /api/scenario-preview ---
  app.post(
    "/api/scenario-preview",
    async (req: Request, res: Response) => {
      try {
        const { hour, isDay, lat, lon, timezone, weather } = req.body;

        if (hour === undefined || typeof hour !== "number" || hour < 0 || hour > 23) {
          res.status(400).json({ error: "hour must be an integer 0-23" });
          return;
        }

        const scenario = createScenarioFromHour(
          hour,
          isDay !== undefined ? Boolean(isDay) : undefined,
        );

        // Apply weather data if provided
        if (weather) {
          scenario.weatherCode = weather.weatherCode;
          scenario.temperature = weather.temperature;
          scenario.humidity = weather.humidity;
          scenario.windSpeed = weather.windSpeed;
          scenario.windGusts = weather.windGusts;
          scenario.visibility = weather.visibility;
          scenario.precipitation = weather.precipitation;
          scenario.rain = weather.rain;
          scenario.snowfall = weather.snowfall;
          scenario.snowDepth = weather.snowDepth;
          scenario.directRadiation = weather.directRadiation;
          scenario.diffuseRadiation = weather.diffuseRadiation;
          scenario.cloudPercent = weather.cloudPercent;
          scenario.precipProbability = weather.precipProbability;
          if (weather.isDay !== undefined) {
            scenario.isDay = weather.isDay;
          }
        }

        // Compute sun/moon position if location provided
        if (lat !== undefined && lon !== undefined && timezone) {
          computeSunMoon(scenario, hour, lat, lon, timezone);
        }

        res.json({ description: describeScenario(scenario) });
      } catch (err) {
        console.error(
          `[${new Date().toISOString()}] Scenario preview error:`,
          err instanceof Error ? err.message : err,
        );
        res.status(500).json({ error: "Scenario preview failed" });
      }
    },
  );

  return app;
}

