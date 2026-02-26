interface Props {
  running: boolean | null;
  isToggling: boolean;
  error: string | null;
  onToggle: () => void;
}

export function SchedulerPause({ running, isToggling, error, onToggle }: Props) {
  if (running === null) return null;

  return (
    <div className="scheduler-pause">
      <button
        className={`btn-scheduler-toggle ${running ? "is-running" : "is-paused"}`}
        disabled={isToggling}
        onClick={onToggle}
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
