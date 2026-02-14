interface Props {
  hour: number;
  isDay: boolean;
  onHourChange: (hour: number) => void;
  onIsDayChange: (isDay: boolean) => void;
}

function getTimeOfDayDescription(hour: number): string {
  if (hour >= 5 && hour < 7) return "Early morning, dawn breaking";
  if (hour >= 7 && hour < 12) return "Morning, bright daylight";
  if (hour >= 12 && hour < 14) return "Midday, sun high overhead";
  if (hour >= 14 && hour < 17) return "Afternoon, warm light";
  if (hour >= 17 && hour < 20) return "Evening, golden hour, sunset";
  if (hour >= 20 && hour < 22) return "Dusk, twilight";
  return "Night, darkness, moonlight";
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
