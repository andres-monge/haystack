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
import SunCalc from "suncalc";

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
      const data = await fs.promises.readFile(imagePath);
      res.setHeader("Content-Type", "image/png");
      res.send(data);
    } catch {
      res.status(404).json({ error: "Output not found" });
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
    // Use explicit overrides, ignoring non-numeric values
    if (body.weatherCode !== undefined) {
      const val = parseInt(body.weatherCode, 10);
      if (!isNaN(val)) scenario.weatherCode = val;
    }
    if (body.cloudPercent !== undefined) {
      const val = parseInt(body.cloudPercent, 10);
      if (!isNaN(val)) scenario.cloudPercent = val;
    }
    if (body.precipProbability !== undefined) {
      const val = parseInt(body.precipProbability, 10);
      // API field "precipProbability" maps to Scenario's "precipPercent"
      if (!isNaN(val)) scenario.precipPercent = val;
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
        scenario.temperature = slot.temperature;
        scenario.humidity = slot.humidity;
        scenario.windSpeed = slot.windSpeed;
        scenario.windGusts = slot.windGusts;
        scenario.visibility = slot.visibility;
        scenario.precipitation = slot.precipitation;
        scenario.rain = slot.rain;
        scenario.snowfall = slot.snowfall;
        scenario.snowDepth = slot.snowDepth;
        scenario.directRadiation = slot.directRadiation;
        scenario.diffuseRadiation = slot.diffuseRadiation;
      }
    } catch (err) {
      // Weather fetch failed — fall back to time-only scenario
      console.error(
        `[${new Date().toISOString()}] Weather fetch failed during generate, using time-only scenario: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Compute sun/moon position from lat/lon + hour
    const dateForHour = new Date(
      new Date().toLocaleDateString("en-CA", { timeZone: timezone }) + `T${String(hour).padStart(2, "0")}:00:00`,
    );
    const sunPos = SunCalc.getPosition(dateForHour, lat, lon);
    scenario.sunElevation = Math.round(sunPos.altitude * (180 / Math.PI) * 10) / 10;
    scenario.sunAzimuth = Math.round(((sunPos.azimuth * (180 / Math.PI)) + 180) * 10) / 10; // suncalc measures from south, convert to 0-360 from north

    const moonIllum = SunCalc.getMoonIllumination(dateForHour);
    scenario.moonFraction = Math.round(moonIllum.fraction * 100) / 100;

    const moonPos = SunCalc.getMoonPosition(dateForHour, lat, lon);
    scenario.moonAltitude = Math.round(moonPos.altitude * (180 / Math.PI) * 10) / 10;
  }

  return scenario;
}
