import type { RenderMetadata } from "../types";

interface Props {
  renders: Array<RenderMetadata & { imageUrl: string }>;
  isLoading: boolean;
  onSelect: (render: RenderMetadata & { imageUrl: string }) => void;
}

const WMO_SHORT: Record<number, string> = {
  0: "Clear",
  1: "Clear",
  2: "Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  61: "Rain",
  63: "Rain",
  65: "Rain",
  71: "Snow",
  73: "Snow",
  95: "Storm",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryPanel({ renders, isLoading, onSelect }: Props) {
  if (isLoading && renders.length === 0) {
    return (
      <div className="history-panel">
        <label className="section-label">History</label>
        <div className="history-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <label className="section-label">History ({renders.length})</label>
      {renders.length === 0 ? (
        <div className="history-empty">No generations yet</div>
      ) : (
        <div className="history-grid">
          {renders.map((render) => (
            <div
              key={render.id}
              className="history-item"
              onClick={() => onSelect(render)}
            >
              <img
                src={render.imageUrl}
                alt={`Hour ${render.scenario.hour}`}
                loading="lazy"
              />
              <div className="history-item-info">
                <span>{formatTime(render.createdAt)}</span>
                <span>{render.scenario.hour}:00</span>
                {render.scenario.weatherCode !== undefined && (
                  <span className="weather-badge">
                    {WMO_SHORT[render.scenario.weatherCode] ??
                      `W${render.scenario.weatherCode}`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
