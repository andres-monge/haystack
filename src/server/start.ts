// src/server/start.ts — Lab server entry point

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createApp } from "./server.js";
import { Pipeline } from "../engine/pipeline.js";
import { OpenMeteoProvider } from "../weather/open-meteo.js";
import { loadConfigFromEnv, toPipelineConfig } from "../config/config.js";
import { HourlyScheduler } from "./scheduler.js";

const config = loadConfigFromEnv();
const pipeline = new Pipeline(toPipelineConfig(config), config.googleApiKey);
const weatherProvider = new OpenMeteoProvider();
const port = parseInt(process.env.HAYSTACK_LAB_PORT ?? "4321", 10);

// Create scheduler when both imageDir and schedulerLocation are configured
let scheduler: HourlyScheduler | undefined;
if (config.imageDir && config.schedulerLocation) {
  scheduler = new HourlyScheduler({
    pipeline,
    weatherProvider,
    imageDir: config.imageDir,
    location: config.schedulerLocation,
  });
}

const app = createApp({
  pipeline,
  weatherProvider,
  outputDir: config.outputDir,
  scheduler,
});

const server = app.listen(port, config.bindHost, () => {
  console.log(
    `Haystack Lab server running at http://${config.bindHost}:${port}`,
  );
});

// Start scheduler after server is listening
if (scheduler && config.schedulerLocation) {
  scheduler.start();
  const { lat, lon } = config.schedulerLocation;
  console.log(`Hourly scheduler started (location: ${lat}, ${lon})`);
}

// Graceful shutdown
function shutdown() {
  if (scheduler) {
    scheduler.stop();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
