import { useCallback, useEffect, useState } from "react";
import { getHistory } from "../api/client";
import type { RenderMetadata } from "../types";

export function useHistory() {
  const [renders, setRenders] = useState<
    Array<RenderMetadata & { imageUrl: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getHistory();
      setRenders(res.renders);
    } catch {
      // Silently ignore — history is non-critical
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { renders, isLoading, refresh };
}
