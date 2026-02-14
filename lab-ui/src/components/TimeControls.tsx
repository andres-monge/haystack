import { getTimeOfDayDescription } from "../utils/scenario";

interface Props {
  hour: number;
  isDay: boolean;
  onHourChange: (hour: number) => void;
  onIsDayChange: (isDay: boolean) => void;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function TimeControls({
  hour,
  isDay,
  onHourChange,
  onIsDayChange,
}: Props) {
  return (
    <div className="time-controls">
      <label className="section-label">Time of Day</label>
      <div className="hour-slider">
        <input
          type="range"
          min={0}
          max={23}
          value={hour}
          onChange={(e) => {
            const h = parseInt(e.target.value, 10);
            onHourChange(h);
            // Auto-calculate isDay
            onIsDayChange(h >= 6 && h <= 20);
          }}
        />
        <div className="hour-label">
          <span className="hour-value">{formatHour(hour)}</span>
          <span className="hour-description">
            {getTimeOfDayDescription(hour)}
          </span>
        </div>
      </div>
      <label className="is-day-toggle">
        <input
          type="checkbox"
          checked={isDay}
          onChange={(e) => onIsDayChange(e.target.checked)}
        />
        <span>Daytime</span>
      </label>
    </div>
  );
}
