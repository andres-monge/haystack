import { describe, expect, it, vi } from "vitest";
import {
  createProviderRegistry,
  type ProviderAdapterFactories,
} from "../../src/engine/provider-factory.js";
import type {
  ImageProviderAdapter,
  ImageProviderId,
} from "../../src/engine/provider-types.js";

function adapter(provider: ImageProviderId): ImageProviderAdapter {
  return {
    provider,
    model: `${provider}-model`,
    editImage: vi.fn(),
  };
}

function factories() {
  return {
    gemini: vi.fn(() => adapter("gemini")),
    openai: vi.fn(() => adapter("openai")),
    xai: vi.fn(() => adapter("xai")),
  } satisfies ProviderAdapterFactories;
}

describe("createProviderRegistry", () => {
  it("constructs only selected adapters in exact configured order", () => {
    const constructors = factories();

    const registry = createProviderRegistry({
      providerOrder: ["xai", "gemini"],
      providerKeys: { gemini: "google-secret", xai: "xai-secret" },
      geminiModels: {
        normal: "gemini-3.1-flash-lite-image",
        extend: "gemini-3.1-flash-image",
      },
      defaultSeed: 42,
    }, constructors);

    expect(registry.ids).toEqual(["xai", "gemini"]);
    expect(Object.isFrozen(registry.ids)).toBe(true);
    expect(registry.get("xai").provider).toBe("xai");
    expect(registry.get("gemini").provider).toBe("gemini");
    expect(() => registry.get("openai")).toThrow(/not configured/i);
    expect(constructors.xai).toHaveBeenCalledWith("xai-secret", { timeoutMs: 180_000 });
    expect(constructors.gemini).toHaveBeenCalledWith("google-secret", {
      timeoutMs: 180_000,
      models: {
        normal: "gemini-3.1-flash-lite-image",
        "extend-cleanup": "gemini-3.1-flash-image",
        "extend-outpaint": "gemini-3.1-flash-image",
      },
      seed: 42,
    });
    expect(constructors.openai).not.toHaveBeenCalled();
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it("validates every selected key before constructing any client", () => {
    const constructors = factories();

    expect(() => createProviderRegistry({
      providerOrder: ["gemini", "openai"],
      providerKeys: { gemini: "google-secret" },
      geminiModels: {
        normal: "gemini-3.1-flash-lite-image",
        extend: "gemini-3.1-flash-image",
      },
    }, constructors)).toThrow(/OPENAI_API_KEY.*openai/i);

    expect(constructors.gemini).not.toHaveBeenCalled();
    expect(constructors.openai).not.toHaveBeenCalled();
    expect(constructors.xai).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid configured seed %s before constructing a client",
    defaultSeed => {
      const constructors = factories();

      expect(() => createProviderRegistry({
        providerOrder: ["gemini"],
        providerKeys: { gemini: "google-secret" },
        geminiModels: {
          normal: "gemini-3.1-flash-lite-image",
          extend: "gemini-3.1-flash-image",
        },
        defaultSeed,
      }, constructors)).toThrow(/seed.*non-negative safe integer/i);

      expect(constructors.gemini).not.toHaveBeenCalled();
    },
  );

  it("keeps credentials private and out of registry serialization", () => {
    const constructors = factories();
    const registry = createProviderRegistry({
      providerOrder: ["openai"],
      providerKeys: { openai: "openai-super-secret" },
      geminiModels: {
        normal: "gemini-3.1-flash-lite-image",
        extend: "gemini-3.1-flash-image",
      },
    }, constructors);

    expect(JSON.stringify(registry)).not.toContain("openai-super-secret");
    expect(constructors.openai).toHaveBeenCalledWith("openai-super-secret", {
      timeoutMs: 180_000,
    });
  });
});
