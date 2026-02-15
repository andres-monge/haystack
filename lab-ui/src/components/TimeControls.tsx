import { formatHour, getTimeOfDayDescription } from "../utils/scenario";

interface Props {
  hour: number;
  isDay: boolean;
  onHourChange: (hour: number) => void;
  onIsDayChange: (isDay: boolean) => void;
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
          onChange={(e) => onHourChange(parseInt(e.target.value, 10))}
        />
        <div className="hour-label">
          <span className="hour-value">{formatHour(hour)}</span>
          <span className="hour-description">
            {getTimeOfDayDescription(hour, isDay)}
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
