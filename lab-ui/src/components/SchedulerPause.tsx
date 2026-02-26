import { useCallback, useEffect, useState } from "react";
import {
  getSchedulerStatus,
  pauseScheduler,
  resumeScheduler,
} from "../api/client";

export function SchedulerPause() {
  const [running, setRunning] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSchedulerStatus()
      .then((s) => setRunning(s.running))
      .catch(() => setRunning(null));
  }, []);

  const handleToggle = useCallback(async () => {
    if (running === null) return;
    setIsToggling(true);
    setError(null);
    try {
      const result = running
        ? await pauseScheduler()
        : await resumeScheduler();
      setRunning(result.running);
    } catch {
      setError(running ? "Failed to pause" : "Failed to resume");
    } finally {
      setIsToggling(false);
    }
  }, [running]);

  // Don't render if scheduler isn't configured (status fetch failed)
  if (running === null) return null;

  return (
    <div className="scheduler-pause">
      <button
        className={`btn-scheduler-toggle ${running ? "is-running" : "is-paused"}`}
        disabled={isToggling}
        onClick={handleToggle}
      >
        {isToggling
          ? running
            ? "Pausing..."
            : "Resuming..."
          : running
            ? "Pause Scheduler"
            : "Resume Scheduler"}
      </button>
      <span className="scheduler-status">
        {running ? "Scheduler active" : "Scheduler paused"}
      </span>
      {error && <span className="scheduler-error">{error}</span>}
    </div>
  );
}
