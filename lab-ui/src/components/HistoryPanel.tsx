import type { RenderMetadata } from "../types";
import { WMO_SHORT } from "../utils/scenario";

interface Props {
  renders: Array<RenderMetadata & { imageUrl: string }>;
  isLoading: boolean;
  onSelect: (render: RenderMetadata & { imageUrl: string }) => void;
}

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
