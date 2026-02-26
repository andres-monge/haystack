import { useCallback, useEffect, useState } from "react";
import {
  getSchedulerStatus,
  pauseScheduler,
  resumeScheduler,
} from "../api/client";

export function useScheduler() {
  const [running, setRunning] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSchedulerStatus()
      .then((s) => setRunning(s.running))
      .catch(() => setRunning(null));
  }, []);

  const toggle = useCallback(async () => {
    if (running === null) return;
    setIsToggling(true);
    setError(null);
    try {
      const result = running
        ? await pauseScheduler()
        : await resumeScheduler();
      setRunning(result.running);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scheduler action failed");
    } finally {
      setIsToggling(false);
    }
  }, [running]);

  return { running, isToggling, error, toggle };
}
