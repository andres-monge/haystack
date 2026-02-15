// src/server/start.ts — Lab server entry point

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createApp } from "./server.js";
import { Pipeline } from "../engine/pipeline.js";
import { OpenMeteoProvider } from "../weather/open-meteo.js";
import { loadConfigFromEnv, toPipelineConfig } from "../config/config.js";

const config = loadConfigFromEnv();
const pipeline = new Pipeline(toPipelineConfig(config), config.googleApiKey);
const weatherProvider = new OpenMeteoProvider();
const port = parseInt(process.env.HAYSTACK_LAB_PORT ?? "4321", 10);

const app = createApp({
  pipeline,
  weatherProvider,
  outputDir: config.outputDir,
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Haystack Lab server running at http://localhost:${port}`);
});
