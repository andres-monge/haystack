import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadComparisonKeysFromEnv,
  loadConfigFromEnv,
  toPipelineConfig,
  toProviderFactoryConfig,
} from "../../src/config/config.js";

describe("loadConfigFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all HAYSTACK_ and API key vars before each test
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.HAYSTACK_IMAGE_PROVIDER_ORDER;
    delete process.env.HAYSTACK_OUTPUT_DIR;
    delete process.env.HAYSTACK_MODEL;
    delete process.env.HAYSTACK_ASPECT_RATIO;
    delete process.env.HAYSTACK_SEED;
    delete process.env.HAYSTACK_MAX_OUTPUTS;
    delete process.env.HAYSTACK_BIND_HOST;
    delete process.env.HAYSTACK_IMAGE_DIR;
    delete process.env.HAYSTACK_LAT;
    delete process.env.HAYSTACK_LON;
    delete process.env.HAYSTACK_TIMEZONE;
    delete process.env.HAYSTACK_ACTIVE_START;
    delete process.env.HAYSTACK_ACTIVE_END;
    delete process.env.HAYSTACK_EXTEND_MODEL;
    process.env.GOOGLE_API_KEY = "test-google-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns sensible defaults when only a provider key is set", () => {
    const config = loadConfigFromEnv();
    expect(config.googleApiKey).toBe("test-google-key");
    expect(config.outputDir).toContain(".haystack");
    expect(config.outputDir).toContain("outputs");
    expect(config.defaultModel).toBe("gemini-3.1-flash-lite-image");
    expect(config.defaultAspectRatio).toBeUndefined();
    expect(config.defaultSeed).toBeUndefined();
    expect(config.maxStoredOutputs).toBe(24);
    expect(config.bindHost).toBe("127.0.0.1");
    expect(config.imageDir).toBeUndefined();
    expect(config.schedulerLocation).toBeUndefined();
    expect(config.activeStart).toBeUndefined();
    expect(config.activeEnd).toBeUndefined();
    expect(config.extendModel).toBe("gemini-3.1-flash-image");
    expect(config.imageProviderOrder).toEqual(["gemini"]);
    expect(Object.isFrozen(config.imageProviderOrder)).toBe(true);
  });

  it("prefers GOOGLE_API_KEY over GEMINI_API_KEY", () => {
    process.env.GOOGLE_API_KEY = "google-key";
    process.env.GEMINI_API_KEY = "gemini-key";
    const config = loadConfigFromEnv();
    expect(config.googleApiKey).toBe("google-key");
  });

  it("falls back to GEMINI_API_KEY when GOOGLE_API_KEY is missing", () => {
    delete process.env.GOOGLE_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-key";
    const config = loadConfigFromEnv();
    expect(config.googleApiKey).toBe("gemini-key");
  });

  it("falls back to GEMINI_API_KEY when GOOGLE_API_KEY is blank", () => {
    process.env.GOOGLE_API_KEY = "   ";
    process.env.GEMINI_API_KEY = "gemini-key";

    expect(loadConfigFromEnv().googleApiKey).toBe("gemini-key");
  });

  it("reads custom output directory", () => {
    process.env.HAYSTACK_OUTPUT_DIR = "/tmp/custom-outputs";
    const config = loadConfigFromEnv();
    expect(config.outputDir).toBe("/tmp/custom-outputs");
  });

  it.each([
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
  ])("accepts valid model value %s", model => {
    process.env.HAYSTACK_MODEL = model;
    const config = loadConfigFromEnv();
    expect(config.defaultModel).toBe(model);
  });

  it("throws on invalid model value", () => {
    process.env.HAYSTACK_MODEL = "gpt-4o";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_MODEL.*gpt-4o/);
  });

  it.each([
    ["gemini-3.1-flash-image-preview", "gemini-3.1-flash-image"],
    ["gemini-3-pro-image-preview", "gemini-3-pro-image"],
  ])("rejects retired model %s with its stable replacement", (retired, replacement) => {
    process.env.HAYSTACK_MODEL = retired;
    expect(() => loadConfigFromEnv()).toThrow(
      new RegExp(`${retired}.*retired.*${replacement}`, "i"),
    );
  });

  it("warns when the retiring Gemini 2.5 model is explicitly selected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.HAYSTACK_MODEL = "gemini-2.5-flash-image";

    loadConfigFromEnv();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/October 2026.*gemini-3.1-flash-lite-image/i));
    warn.mockRestore();
  });

  // --- Extend model ---

  it("accepts valid HAYSTACK_EXTEND_MODEL override", () => {
    process.env.HAYSTACK_EXTEND_MODEL = "gemini-3.1-flash-lite-image";
    const config = loadConfigFromEnv();
    expect(config.extendModel).toBe("gemini-3.1-flash-lite-image");
  });

  it("throws on invalid HAYSTACK_EXTEND_MODEL with correct env var name", () => {
    process.env.HAYSTACK_EXTEND_MODEL = "invalid-model";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_EXTEND_MODEL.*invalid-model/);
  });

  it("rejects the retired extend preview with its stable replacement", () => {
    process.env.HAYSTACK_EXTEND_MODEL = "gemini-3.1-flash-image-preview";
    expect(() => loadConfigFromEnv()).toThrow(
      /HAYSTACK_EXTEND_MODEL.*gemini-3.1-flash-image-preview.*retired.*gemini-3.1-flash-image/i,
    );
  });

  // --- Production provider selection ---

  it("derives all available providers in preferred order", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.XAI_API_KEY = "xai-key";

    const config = loadConfigFromEnv();

    expect(config.imageProviderOrder).toEqual(["openai", "gemini", "xai"]);
    expect(config.providerKeys).toEqual({
      gemini: "test-google-key",
      openai: "openai-key",
      xai: "xai-key",
    });
  });

  it("derives only the available providers when order is unset", () => {
    delete process.env.GOOGLE_API_KEY;
    process.env.OPENAI_API_KEY = "openai-key";

    expect(loadConfigFromEnv().imageProviderOrder).toEqual(["openai"]);
  });

  it("accepts an explicit reordered subset and requires no omitted key", () => {
    process.env.XAI_API_KEY = "xai-key";
    process.env.HAYSTACK_IMAGE_PROVIDER_ORDER = " xai , gemini ";

    expect(loadConfigFromEnv().imageProviderOrder).toEqual(["xai", "gemini"]);
  });

  it.each([
    "",
    "   ",
    "gemini,,openai",
    "unknown",
    "gemini,gemini",
  ])("rejects invalid explicit provider order %j", (order) => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.HAYSTACK_IMAGE_PROVIDER_ORDER = order;
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_IMAGE_PROVIDER_ORDER/);
  });

  it("rejects an explicit provider whose key is missing", () => {
    process.env.HAYSTACK_IMAGE_PROVIDER_ORDER = "gemini,openai";
    expect(() => loadConfigFromEnv()).toThrow(/OPENAI_API_KEY.*openai/i);
  });

  it("rejects startup when no direct provider key is available", () => {
    delete process.env.GOOGLE_API_KEY;
    expect(() => loadConfigFromEnv()).toThrow(
      /at least one.*GOOGLE_API_KEY.*OPENAI_API_KEY.*XAI_API_KEY/i,
    );
  });

  it("does not serialize direct provider credentials", () => {
    process.env.OPENAI_API_KEY = "openai-super-secret";
    process.env.XAI_API_KEY = "xai-super-secret";

    const config = loadConfigFromEnv();
    const serialized = JSON.stringify(config);

    expect(serialized).not.toContain("test-google-key");
    expect(serialized).not.toContain("openai-super-secret");
    expect(serialized).not.toContain("xai-super-secret");
    expect(JSON.stringify(config.providerKeys)).toBeUndefined();
  });

  it("accepts valid aspect ratio values", () => {
    process.env.HAYSTACK_ASPECT_RATIO = "16:9";
    const config = loadConfigFromEnv();
    expect(config.defaultAspectRatio).toBe("16:9");
  });

  it("throws on invalid aspect ratio value", () => {
    process.env.HAYSTACK_ASPECT_RATIO = "banana";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_ASPECT_RATIO.*banana/);
  });

  it("parses valid seed", () => {
    process.env.HAYSTACK_SEED = "42";
    const config = loadConfigFromEnv();
    expect(config.defaultSeed).toBe(42);
  });

  it("throws on non-numeric seed", () => {
    process.env.HAYSTACK_SEED = "abc";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_SEED.*not a valid integer/);
  });

  it("parses valid max outputs", () => {
    process.env.HAYSTACK_MAX_OUTPUTS = "10";
    const config = loadConfigFromEnv();
    expect(config.maxStoredOutputs).toBe(10);
  });

  it("throws on non-numeric max outputs", () => {
    process.env.HAYSTACK_MAX_OUTPUTS = "xyz";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_MAX_OUTPUTS.*not a valid integer/);
  });

  it("reads custom bind host", () => {
    process.env.HAYSTACK_BIND_HOST = "0.0.0.0";
    const config = loadConfigFromEnv();
    expect(config.bindHost).toBe("0.0.0.0");
  });

  it("reads image directory", () => {
    process.env.HAYSTACK_IMAGE_DIR = "/tmp/artworks";
    const config = loadConfigFromEnv();
    expect(config.imageDir).toBe("/tmp/artworks");
  });

  it("treats empty HAYSTACK_IMAGE_DIR as undefined", () => {
    process.env.HAYSTACK_IMAGE_DIR = "";
    const config = loadConfigFromEnv();
    expect(config.imageDir).toBeUndefined();
  });

  it("populates schedulerLocation when all three vars are set", () => {
    process.env.HAYSTACK_LAT = "34.05";
    process.env.HAYSTACK_LON = "-118.25";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    const config = loadConfigFromEnv();
    expect(config.schedulerLocation).toEqual({
      lat: 34.05,
      lon: -118.25,
      timezone: "America/Los_Angeles",
    });
  });

  it("leaves schedulerLocation undefined when only lat is set", () => {
    process.env.HAYSTACK_LAT = "34.05";
    const config = loadConfigFromEnv();
    expect(config.schedulerLocation).toBeUndefined();
  });

  it("leaves schedulerLocation undefined when only lat and lon are set", () => {
    process.env.HAYSTACK_LAT = "34.05";
    process.env.HAYSTACK_LON = "-118.25";
    const config = loadConfigFromEnv();
    expect(config.schedulerLocation).toBeUndefined();
  });

  it("leaves schedulerLocation undefined when only timezone is set", () => {
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    const config = loadConfigFromEnv();
    expect(config.schedulerLocation).toBeUndefined();
  });

  it("throws on non-numeric latitude", () => {
    process.env.HAYSTACK_LAT = "north";
    process.env.HAYSTACK_LON = "-118.25";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_LAT.*not a valid number/);
  });

  it("throws on non-numeric longitude", () => {
    process.env.HAYSTACK_LAT = "34.05";
    process.env.HAYSTACK_LON = "west";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_LON.*not a valid number/);
  });

  it("throws on Infinity latitude", () => {
    process.env.HAYSTACK_LAT = "Infinity";
    process.env.HAYSTACK_LON = "-118.25";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    expect(() => loadConfigFromEnv()).toThrow(/Invalid HAYSTACK_LAT.*not a valid number/);
  });

  it("throws on latitude out of range", () => {
    process.env.HAYSTACK_LAT = "91";
    process.env.HAYSTACK_LON = "-118.25";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_LAT.*outside range/);
  });

  it("throws on longitude out of range", () => {
    process.env.HAYSTACK_LAT = "34.05";
    process.env.HAYSTACK_LON = "181";
    process.env.HAYSTACK_TIMEZONE = "America/Los_Angeles";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_LON.*outside range/);
  });

  it("throws on invalid timezone", () => {
    process.env.HAYSTACK_LAT = "34.05";
    process.env.HAYSTACK_LON = "-118.25";
    process.env.HAYSTACK_TIMEZONE = "Not/A_Timezone";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_TIMEZONE.*not a recognized IANA timezone/);
  });

  // --- Active hours ---

  it("defaults to no active hours when env vars are unset", () => {
    const config = loadConfigFromEnv();
    expect(config.activeStart).toBeUndefined();
    expect(config.activeEnd).toBeUndefined();
  });

  it("parses valid active hours", () => {
    process.env.HAYSTACK_ACTIVE_START = "9";
    process.env.HAYSTACK_ACTIVE_END = "21";
    const config = loadConfigFromEnv();
    expect(config.activeStart).toBe(9);
    expect(config.activeEnd).toBe(21);
  });

  it("accepts boundary values 0 and 23", () => {
    process.env.HAYSTACK_ACTIVE_START = "0";
    process.env.HAYSTACK_ACTIVE_END = "23";
    const config = loadConfigFromEnv();
    expect(config.activeStart).toBe(0);
    expect(config.activeEnd).toBe(23);
  });

  it("throws when only HAYSTACK_ACTIVE_START is set", () => {
    process.env.HAYSTACK_ACTIVE_START = "9";
    expect(() => loadConfigFromEnv()).toThrow(/must both be set or both be omitted/);
  });

  it("throws when only HAYSTACK_ACTIVE_END is set", () => {
    process.env.HAYSTACK_ACTIVE_END = "21";
    expect(() => loadConfigFromEnv()).toThrow(/must both be set or both be omitted/);
  });

  it("throws when HAYSTACK_ACTIVE_START is out of range", () => {
    process.env.HAYSTACK_ACTIVE_START = "25";
    process.env.HAYSTACK_ACTIVE_END = "21";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_ACTIVE_START.*outside range/);
  });

  it("throws when HAYSTACK_ACTIVE_END is out of range", () => {
    process.env.HAYSTACK_ACTIVE_START = "9";
    process.env.HAYSTACK_ACTIVE_END = "-1";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_ACTIVE_END.*outside range/);
  });

  it("throws when start >= end", () => {
    process.env.HAYSTACK_ACTIVE_START = "21";
    process.env.HAYSTACK_ACTIVE_END = "9";
    expect(() => loadConfigFromEnv()).toThrow(/must be less than/);
  });

  it("throws when start equals end", () => {
    process.env.HAYSTACK_ACTIVE_START = "12";
    process.env.HAYSTACK_ACTIVE_END = "12";
    expect(() => loadConfigFromEnv()).toThrow(/must be less than/);
  });

  it("throws on non-numeric active hour values", () => {
    process.env.HAYSTACK_ACTIVE_START = "nine";
    process.env.HAYSTACK_ACTIVE_END = "21";
    expect(() => loadConfigFromEnv()).toThrow(/HAYSTACK_ACTIVE_START.*not a valid integer/);
  });
});

describe("loadComparisonKeysFromEnv", () => {
  it("loads optional direct-provider keys without changing production config", () => {
    const env = {
      GOOGLE_API_KEY: "google-secret",
      OPENAI_API_KEY: "openai-secret",
      XAI_API_KEY: "xai-secret",
    };

    expect(loadComparisonKeysFromEnv(env)).toEqual({
      googleApiKey: "google-secret",
      openaiApiKey: "openai-secret",
      xaiApiKey: "xai-secret",
    });

    const previousGoogleKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "production-secret";
    try {
      const production = loadConfigFromEnv();
      expect(production).not.toHaveProperty("openaiApiKey");
      expect(production).not.toHaveProperty("xaiApiKey");
    } finally {
      if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = previousGoogleKey;
    }
  });

  it("supports GEMINI_API_KEY fallback and leaves missing challenger keys undefined", () => {
    expect(loadComparisonKeysFromEnv({ GEMINI_API_KEY: "gemini-secret" })).toEqual({
      googleApiKey: "gemini-secret",
      openaiApiKey: undefined,
      xaiApiKey: undefined,
    });
  });
});

describe("toPipelineConfig", () => {
  it("maps all required fields", () => {
    const result = toPipelineConfig({
      googleApiKey: "key",
      providerKeys: { gemini: "key" },
      imageProviderOrder: ["gemini"],
      outputDir: "/out",
      defaultModel: "gemini-2.5-flash-image",
      maxStoredOutputs: 10,
      bindHost: "127.0.0.1",
      extendModel: "gemini-3.1-flash-image",
    });

    expect(result.outputDir).toBe("/out");
    expect(result.maxOutputs).toBe(10);
    expect(result.geminiConfig?.model).toBe("gemini-2.5-flash-image");
  });

  it("includes optional fields when set", () => {
    const result = toPipelineConfig({
      googleApiKey: "key",
      providerKeys: { gemini: "key" },
      imageProviderOrder: ["gemini"],
      outputDir: "/out",
      defaultModel: "gemini-2.5-flash-image",
      defaultAspectRatio: "16:9",
      defaultSeed: 42,
      maxStoredOutputs: 24,
      bindHost: "127.0.0.1",
      extendModel: "gemini-3.1-flash-image",
    });

    expect(result.geminiConfig?.aspectRatio).toBe("16:9");
    expect(result.geminiConfig?.seed).toBe(42);
  });

  it("leaves optional fields undefined when not set", () => {
    const result = toPipelineConfig({
      googleApiKey: "key",
      providerKeys: { gemini: "key" },
      imageProviderOrder: ["gemini"],
      outputDir: "/out",
      defaultModel: "gemini-2.5-flash-image",
      maxStoredOutputs: 24,
      bindHost: "127.0.0.1",
      extendModel: "gemini-3.1-flash-image",
    });

    expect(result.geminiConfig?.aspectRatio).toBeUndefined();
    expect(result.geminiConfig?.seed).toBeUndefined();
  });

  it("does not include googleApiKey in pipeline config", () => {
    const result = toPipelineConfig({
      googleApiKey: "secret-key",
      providerKeys: { gemini: "secret-key" },
      imageProviderOrder: ["gemini"],
      outputDir: "/out",
      defaultModel: "gemini-2.5-flash-image",
      maxStoredOutputs: 24,
      bindHost: "127.0.0.1",
      extendModel: "gemini-3.1-flash-image",
    });

    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});

describe("toProviderFactoryConfig", () => {
  it("maps provider construction inputs separately from PipelineConfig", () => {
    const config = {
      googleApiKey: "google-secret",
      providerKeys: { gemini: "google-secret", openai: "openai-secret" },
      imageProviderOrder: ["openai", "gemini"] as const,
      outputDir: "/out",
      defaultModel: "gemini-3.1-flash-lite-image" as const,
      defaultSeed: 42,
      maxStoredOutputs: 24,
      bindHost: "127.0.0.1",
      extendModel: "gemini-3.1-flash-image" as const,
    };

    expect(toProviderFactoryConfig(config)).toEqual({
      providerOrder: ["openai", "gemini"],
      providerKeys: { gemini: "google-secret", openai: "openai-secret" },
      geminiModels: {
        normal: "gemini-3.1-flash-lite-image",
        extend: "gemini-3.1-flash-image",
      },
      defaultSeed: 42,
    });
    expect(JSON.stringify(toPipelineConfig(config))).not.toContain("secret");
  });
});
