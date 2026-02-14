import { useCallback, useState } from "react";
import { generate } from "../api/client";
import type { GenerateResult } from "../types";

export function useGenerate() {
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (params: Parameters<typeof generate>[0]) => {
      setIsGenerating(true);
      setError(null);
      try {
        const res = await generate(params);
        setResult(res);
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        setError(msg);
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  return { result, isGenerating, error, run };
}
