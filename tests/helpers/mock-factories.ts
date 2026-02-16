// tests/helpers/mock-factories.ts — Shared test fixtures and mock factories

import { vi } from "vitest";
import type { Pipeline } from "../../src/engine/pipeline.js";
import type { OutputStore } from "../../src/storage/output-store.js";
import type { WeatherProvider, HourlyConditions } from "../../src/weather/types.js";
import type { RenderMetadata, GenerateResult } from "../../src/engine/types.js";

/** Base hourly weather conditions reused across all mock shapes. */
export const BASE_CONDITIONS: HourlyConditions = {
  time: "2026-02-14T12:00",
  weatherCode: 0,
  cloudPercent: 10,
  precipProbability: 0,
  temperature: 15,
  isDay: true,
  humidity: 55,
  windSpeed: 8,
  windGusts: 15,
  visibility: 20000,
  precipitation: 0,
  rain: 0,
  snowfall: 0,
  snowDepth: 0,
  directRadiation: 320,
  diffuseRadiation: 80,
};

export function makeMetadata(overrides: Partial<RenderMetadata> = {}): RenderMetadata {
  return {
    id: "20260214_120000_abc12345",
    artworkSource: "/tmp/test-image.png",
    scenario: {
      timestampLocal: "2026-02-14T12:00:00.000Z",
      hour: 12,
      isDay: true,
    },
    prompt: "Transform this artwork...",
    model: "gemini-2.5-flash-image",
    createdAt: "2026-02-14T12:00:00.000Z",
    outputPath: "",
    ...overrides,
  };
}

export function makeGenerateResult(
  overrides: Partial<RenderMetadata> = {},
): GenerateResult {
  const metadata = makeMetadata(overrides);
  return {
    metadata,
    imagePath: "/tmp/output.png",
    imageBuffer: Buffer.from("fake-png-data"),
  };
}

export function createMockPipeline(): Pipeline {
  const mockStore = {
    listAll: vi.fn().mockReturnValue([]),
    getLatest: vi.fn().mockReturnValue(null),
    save: vi.fn(),
  } as unknown as OutputStore;

  return {
    generate: vi.fn().mockResolvedValue(makeGenerateResult()),
    getStore: vi.fn().mockReturnValue(mockStore),
  } as unknown as Pipeline;
}

export function createMockWeatherProvider(): WeatherProvider {
  return {
    searchLocations: vi.fn().mockResolvedValue([
      {
        name: "Madrid",
        country: "Spain",
        lat: 40.4168,
        lon: -3.7038,
        timezone: "Europe/Madrid",
        admin1: "Community of Madrid",
      },
    ]),
    getHourlyConditions: vi.fn().mockResolvedValue([{ ...BASE_CONDITIONS }]),
    getCurrentConditions: vi.fn().mockResolvedValue({
      ...BASE_CONDITIONS,
      sunrise: "2026-02-14T07:30",
      sunset: "2026-02-14T18:15",
    }),
    getForecast: vi.fn().mockResolvedValue({
      current: {
        ...BASE_CONDITIONS,
        sunrise: "2026-02-14T07:30",
        sunset: "2026-02-14T18:15",
      },
      hourly: [{ ...BASE_CONDITIONS }],
    }),
  };
}

/** Extract generate call args with readable names instead of index access. */
export function getGenerateCallArgs(pipeline: Pipeline, callIndex = 0) {
  const calls = vi.mocked(pipeline.generate).mock.calls;
  return {
    imagePath: calls[callIndex][0] as string,
    scenario: calls[callIndex][1],
    promptOverride: calls[callIndex][2] as string | undefined,
  };
}
