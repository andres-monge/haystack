// src/server/start.ts — Lab server entry point

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createApp } from "./server.js";
import { createProductionPipeline } from "../engine/pipeline.js";
import { OpenMeteoProvider } from "../weather/open-meteo.js";
import {
  loadConfigFromEnv,
  toPipelineConfig,
  toProviderFactoryConfig,
} from "../config/config.js";
import { HourlyScheduler } from "./scheduler.js";
import { exportRecap } from "../story/recap-export.js";
import { getDateString } from "./image-rotation.js";
import { StoryStore } from "../story/story-store.js";
import { CodexStoryWriter } from "../story/codex-writer.js";
import { DailyStoryPreparer } from "../story/prepare-story.js";
import { StoryPreparationService } from "../story/preparation-service.js";

const config = loadConfigFromEnv();
const pipeline = createProductionPipeline(
  toPipelineConfig(config),
  toProviderFactoryConfig(config),
);
const weatherProvider = new OpenMeteoProvider();
const port = parseInt(process.env.HAYSTACK_LAB_PORT ?? "4321", 10);

const storyStore = config.story.enabled ? new StoryStore(config.story.stateDir) : undefined;
let storyPreparation: StoryPreparationService | undefined;

// Create scheduler when both imageDir and schedulerLocation are configured
let scheduler: HourlyScheduler | undefined;
if (config.imageDir && config.schedulerLocation) {
  scheduler = new HourlyScheduler({
    pipeline,
    weatherProvider,
    imageDir: config.imageDir,
    location: config.schedulerLocation,
    activeStart: config.activeStart,
    activeEnd: config.activeEnd,
    storyStore,
    trailerDir: config.story.trailerDir,
  });
  if (storyStore) {
    storyPreparation = new StoryPreparationService({
      store: storyStore,
      preparer: new DailyStoryPreparer({
        store: storyStore, stateDir: config.story.stateDir,
        writer: new CodexStoryWriter({ executable: config.story.codexPath }),
        imageDir: config.imageDir, location: config.schedulerLocation,
        weather: weatherProvider, activeStart: config.activeStart, activeEnd: config.activeEnd,
      }),
      timezone: config.schedulerLocation.timezone,
      prepareTime: config.story.prepareTime,
      activeStart: config.activeStart, activeEnd: config.activeEnd,
      trailerDir: config.story.trailerDir,
      outputs: pipeline.getStore(),
      onReady: async () => {
        if (scheduler?.isRunning()) await scheduler.runNowIfNoRecentRender(30 * 60 * 1000);
      },
    });
  }
}

const app = createApp({
  pipeline,
  weatherProvider,
  outputDir: config.outputDir,
  scheduler,
  labPort: port,
});

const server = app.listen(port, config.bindHost, () => {
  console.log(
    `Haystack Lab server running at http://${config.bindHost}:${port}`,
  );
});

// Recovery also runs outside the active image window, without writer or provider work.
if (storyStore && config.story.trailerDir) {
  void exportRecap(storyStore, getDateString(new Date(), 'Europe/Madrid'), config.story.trailerDir, pipeline.getStore())
    .catch(() => console.warn('Daily recap startup recovery unavailable; use story:prepare -- --export to retry'));
}

// Start scheduler after server is listening
if (scheduler && config.schedulerLocation) {
  scheduler.start();
  storyPreparation?.start();
  const { lat, lon } = config.schedulerLocation;
  console.log(`Hourly scheduler started (location: ${lat}, ${lon})`);
}

// Graceful shutdown
function shutdown() {
  storyPreparation?.stop();
  if (scheduler) {
    scheduler.stop();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
