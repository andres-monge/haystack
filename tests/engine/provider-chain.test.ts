import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ImageProviderRegistry,
} from "../../src/engine/provider-factory.js";
import {
  ProviderChain,
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
} from "../../src/engine/provider-chain.js";
import type {
  ImageProviderAdapter,
  ImageProviderId,
  ProviderAttemptOutcome,
  ProviderEditFailure,
  ProviderEditInput,
  ProviderEditResult,
  ProviderEditSuccess,
  ValidatedImage,
} from "../../src/engine/provider-types.js";
import { composePrompt } from "../../src/engine/prompt.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";

const SOURCE_BYTES = Buffer.from("immutable-source-image");

function image(bytes = SOURCE_BYTES): ValidatedImage {
  return {
    bytes: Buffer.from(bytes),
    mimeType: "image/png",
    width: 2,
    height: 1,
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function failure(
  provider: ImageProviderId,
  outcome: Exclude<ProviderAttemptOutcome, "successful">,
  extras: Partial<ProviderEditFailure> = {},
): ProviderEditFailure {
  return {
    provider,
    requestedModel: `${provider}-model`,
    outcome,
    ...extras,
  };
}

function success(provider: ImageProviderId): ProviderEditSuccess {
  return {
    provider,
    requestedModel: `${provider}-model`,
    outcome: "successful",
    image: image(Buffer.from(`${provider}-result`)),
  };
}

function provider(
  id: ImageProviderId,
  implementation: (input: ProviderEditInput) => Promise<ProviderEditResult>,
): ImageProviderAdapter & { editImage: ReturnType<typeof vi.fn> } {
  return {
    provider: id,
    model: `${id}-model`,
    editImage: vi.fn(implementation),
  };
}

function registry(...providers: ImageProviderAdapter[]): ImageProviderRegistry {
  return new ImageProviderRegistry(providers);
}

function editInput(signal?: AbortSignal) {
  return {
    source: image(),
    prompt: "add soft rain",
    output: { stage: "normal", aspectRatio: "source" } as const,
    signal,
  };
}

describe("ProviderChain", () => {
  it("uses configured order and stops after the first structurally valid image", async () => {
    const gemini = provider("gemini", async () => failure("gemini", "refusal"));
    const openai = provider("openai", async () => success("openai"));
    const xai = provider("xai", async () => success("xai"));
    const chain = new ProviderChain(registry(gemini, openai, xai));

    const result = await chain.editImage(editInput());

    expect(result.provider).toBe("openai");
    expect(gemini.editImage).toHaveBeenCalledTimes(1);
    expect(openai.editImage).toHaveBeenCalledTimes(1);
    expect(xai.editImage).not.toHaveBeenCalled();
    expect(result.run.providerOrder).toEqual(["gemini", "openai", "xai"]);
    expect(result.run.attempts.map(attempt => attempt.outcome)).toEqual([
      "refusal",
      "successful",
    ]);
    expect(result.run.terminalOutcome).toBe("successful");
  });

  it("uses a caller-preallocated chain ID for end-to-end terminal correlation", async () => {
    const gemini = provider("gemini", async () => success("gemini"));
    const chain = new ProviderChain(registry(gemini));

    const result = await chain.editImage({
      ...editInput(),
      chainId: "logical-edit-preallocated",
    });

    expect(result.run.chainId).toBe("logical-edit-preallocated");
  });

  it.each([
    "refusal",
    "no_image",
    "invalid_image",
    "unsupported_output_spec",
    "provider_timeout",
    "rate_limited",
    "authentication",
    "quota",
    "provider_error",
  ] as const)("advances after fallback-eligible outcome %s", async outcome => {
    const gemini = provider("gemini", async () => failure("gemini", outcome));
    const openai = provider("openai", async () => success("openai"));
    const chain = new ProviderChain(registry(gemini, openai));

    await expect(chain.editImage(editInput())).resolves.toMatchObject({
      provider: "openai",
    });
    expect(openai.editImage).toHaveBeenCalledTimes(1);
  });

  it("gives fallback providers the exact same story-rich prompt and original source snapshot", async () => {
    const seenBytes: Buffer[] = [];
    const seenOutputs: ProviderEditInput["output"][] = [];
    const storyPrompt = composePrompt(createScenarioFromHour(12));
    const mutableInput = { ...editInput(), prompt: storyPrompt };
    const gemini = provider("gemini", async input => {
      seenBytes.push(Buffer.from(input.source.bytes));
      seenOutputs.push(input.output);
      input.source.bytes.fill(0);
      mutableInput.prompt = "mutated after the run started";
      return failure("gemini", "provider_error");
    });
    const openai = provider("openai", async input => {
      seenBytes.push(Buffer.from(input.source.bytes));
      seenOutputs.push(input.output);
      return success("openai");
    });
    const mutableOrder: ImageProviderId[] = ["gemini", "openai"];
    const chain = new ProviderChain(registry(gemini, openai), { providerOrder: mutableOrder });
    mutableOrder.reverse();

    await chain.editImage(mutableInput);

    expect(seenBytes).toEqual([SOURCE_BYTES, SOURCE_BYTES]);
    expect(seenOutputs).toEqual([
      { stage: "normal", aspectRatio: "source" },
      { stage: "normal", aspectRatio: "source" },
    ]);
    expect(seenOutputs[0]).not.toBe(seenOutputs[1]);
    expect(Object.isFrozen(seenOutputs[0])).toBe(true);
    expect(gemini.editImage.mock.calls[0][0].prompt).toBe(storyPrompt);
    expect(openai.editImage.mock.calls[0][0].prompt).toBe(storyPrompt);
    expect(openai.editImage.mock.calls[0][0].source).toMatchObject({
      mimeType: "image/png",
      width: 2,
      height: 1,
      byteCount: SOURCE_BYTES.length,
      sha256: image().sha256,
    });
    expect(storyPrompt).toContain("makes the viewer pause and wonder what is happening");
  });

  it("accepts and snapshots a configured normal aspect ratio", async () => {
    const seen: ProviderEditInput["output"][] = [];
    const gemini = provider("gemini", async input => {
      seen.push(input.output);
      return success("gemini");
    });
    const chain = new ProviderChain(registry(gemini));

    await chain.editImage({
      ...editInput(),
      output: { stage: "normal", aspectRatio: "16:9" },
    });

    expect(seen).toEqual([{ stage: "normal", aspectRatio: "16:9" }]);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it("throws one typed sanitized aggregate after complete exhaustion", async () => {
    const injectedSecret = "sk-injected-super-secret";
    const gemini = provider("gemini", async () => ({
      ...failure("gemini", "refusal", { safeCode: "content_policy_violation" }),
      rawBody: injectedSecret,
      authorization: `Bearer ${injectedSecret}`,
      imageBase64: Buffer.from("secret-image").toString("base64"),
      message: `provider said ${injectedSecret}`,
    } as ProviderEditFailure));
    const openai = provider("openai", async () => failure("openai", "quota"));
    const chain = new ProviderChain(registry(gemini, openai));

    const caught = await chain.editImage(editInput()).catch(error => error);

    expect(caught).toBeInstanceOf(ProviderChainExhaustedError);
    expect(caught.run.terminalOutcome).toBe("exhausted");
    expect(caught.run.attempts).toMatchObject([
      { ordinal: 1, provider: "gemini", outcome: "refusal", safeCode: "content_policy_violation" },
      { ordinal: 2, provider: "openai", outcome: "quota" },
    ]);
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(injectedSecret);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("c2VjcmV0LWltYWdl");
  });

  it("stops before any call when the caller is already cancelled", async () => {
    const gemini = provider("gemini", async () => success("gemini"));
    const controller = new AbortController();
    controller.abort();
    const chain = new ProviderChain(registry(gemini));

    const caught = await chain.editImage(editInput(controller.signal)).catch(error => error);

    expect(caught).toBeInstanceOf(ProviderChainTerminatedError);
    expect(caught.outcome).toBe("caller_cancelled");
    expect(gemini.editImage).not.toHaveBeenCalled();
  });

  it.each(["caller_cancelled", "chain_deadline"] as const)(
    "does not advance after terminal provider outcome %s",
    async outcome => {
      const gemini = provider("gemini", async () => failure("gemini", outcome));
      const openai = provider("openai", async () => success("openai"));
      const chain = new ProviderChain(registry(gemini, openai));

      const caught = await chain.editImage(editInput()).catch(error => error);

      expect(caught).toBeInstanceOf(ProviderChainTerminatedError);
      expect(caught.outcome).toBe(outcome);
      expect(openai.editImage).not.toHaveBeenCalled();
    },
  );

  it("preserves caller-cancellation provenance during an in-flight attempt", async () => {
    const controller = new AbortController();
    const gemini = provider("gemini", async input => {
      controller.abort();
      return failure("gemini", input.abort?.provenance ?? "provider_error");
    });
    const openai = provider("openai", async () => success("openai"));
    const chain = new ProviderChain(registry(gemini, openai));

    const caught = await chain.editImage(editInput(controller.signal)).catch(error => error);

    expect(caught.outcome).toBe("caller_cancelled");
    expect(caught.run.attempts[0].abortProvenance).toBe("caller_cancelled");
    expect(openai.editImage).not.toHaveBeenCalled();
  });

  it("stops at the total-chain deadline before another provider starts", async () => {
    const chainTimeoutMs = 123_000;
    const deadline = new AbortController();
    const gemini = provider("gemini", async () => {
      deadline.abort();
      return failure("gemini", "provider_error");
    });
    const openai = provider("openai", async () => success("openai"));
    const chain = new ProviderChain(registry(gemini, openai), {
      chainTimeoutMs,
      createDeadlineSignal: timeoutMs => {
        expect(timeoutMs).toBe(chainTimeoutMs);
        return deadline.signal;
      },
    });

    const caught = await chain.editImage(editInput()).catch(error => error);

    expect(caught.outcome).toBe("chain_deadline");
    expect(caught.run.chainTimeoutMs).toBe(chainTimeoutMs);
    expect(caught.run.attempts[0]).toMatchObject({
      outcome: "chain_deadline",
      abortProvenance: "chain_deadline",
    });
    expect(openai.editImage).not.toHaveBeenCalled();
  });

  it("treats an unexpected adapter throw as a non-repairable local failure", async () => {
    const gemini = provider("gemini", async () => {
      throw new Error("raw local failure with secret-key");
    });
    const openai = provider("openai", async () => success("openai"));
    const chain = new ProviderChain(registry(gemini, openai));

    const caught = await chain.editImage(editInput()).catch(error => error);

    expect(caught).toBeInstanceOf(ProviderChainTerminatedError);
    expect(caught.outcome).toBe("local_failure");
    expect(JSON.stringify(caught)).not.toContain("secret-key");
    expect(openai.editImage).not.toHaveBeenCalled();
  });

  it("rejects globally invalid edit input without calling a provider", async () => {
    const gemini = provider("gemini", async () => success("gemini"));
    const chain = new ProviderChain(registry(gemini));

    const caught = await chain.editImage({ ...editInput(), prompt: "   " }).catch(error => error);

    expect(caught).toBeInstanceOf(ProviderChainTerminatedError);
    expect(caught.outcome).toBe("local_failure");
    expect(caught.safeCode).toBe("invalid_prompt");
    expect(gemini.editImage).not.toHaveBeenCalled();
  });

  it("isolates concurrent run IDs, signals, order snapshots, and attempt ledgers", async () => {
    const signals: AbortSignal[] = [];
    const gemini = provider("gemini", async input => {
      signals.push(input.abort!.signal);
      return input.prompt === "fallback"
        ? failure("gemini", "provider_timeout")
        : success("gemini");
    });
    const openai = provider("openai", async () => success("openai"));
    const chain = new ProviderChain(registry(gemini, openai));

    const [fallback, primary] = await Promise.all([
      chain.editImage({ ...editInput(), prompt: "fallback" }),
      chain.editImage({ ...editInput(), prompt: "primary" }),
    ]);

    expect(fallback.provider).toBe("openai");
    expect(primary.provider).toBe("gemini");
    expect(fallback.run.chainId).not.toBe(primary.run.chainId);
    expect(fallback.run.attempts).toHaveLength(2);
    expect(primary.run.attempts).toHaveLength(1);
    expect(fallback.run.attempts).not.toBe(primary.run.attempts);
    expect(fallback.run.providerOrder).not.toBe(primary.run.providerOrder);
    expect(signals[0]).not.toBe(signals[1]);
    expect(Object.isFrozen(fallback.run.attempts)).toBe(true);
    expect(Object.isFrozen(fallback.run.providerOrder)).toBe(true);
  });
});
