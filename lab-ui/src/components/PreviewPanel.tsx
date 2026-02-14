import { useState } from "react";
import type { RenderMetadata } from "../types";

interface Props {
  metadata: RenderMetadata | null;
  imageUrl: string | null;
  error: string | null;
}

export function PreviewPanel({ metadata, imageUrl, error }: Props) {
  const [showDetails, setShowDetails] = useState(false);

  if (error) {
    return (
      <div className="preview-panel">
        <div className="preview-error">{error}</div>
      </div>
    );
  }

  if (!imageUrl || !metadata) {
    return (
      <div className="preview-panel">
        <div className="preview-empty">No generation yet</div>
      </div>
    );
  }

  return (
    <div className="preview-panel">
      <img
        className="preview-image"
        src={imageUrl}
        alt={`Generated at ${metadata.scenario.hour}:00`}
      />
      <button
        className="btn-details-toggle"
        onClick={() => setShowDetails(!showDetails)}
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails && (
        <div className="preview-metadata">
          <dl>
            <dt>Model</dt>
            <dd>{metadata.model}</dd>
            <dt>Created</dt>
            <dd>{new Date(metadata.createdAt).toLocaleString()}</dd>
            <dt>Hour</dt>
            <dd>{metadata.scenario.hour}:00 ({metadata.scenario.isDay ? "day" : "night"})</dd>
            {metadata.scenario.weatherCode !== undefined && (
              <>
                <dt>Weather Code</dt>
                <dd>{metadata.scenario.weatherCode}</dd>
              </>
            )}
            {metadata.usageMetadata && (
              <>
                <dt>Tokens</dt>
                <dd>
                  {metadata.usageMetadata.totalTokenCount ?? "—"}
                </dd>
              </>
            )}
            {metadata.responseText && (
              <>
                <dt>Response</dt>
                <dd className="response-text">{metadata.responseText}</dd>
              </>
            )}
          </dl>
          <details>
            <summary>Full prompt</summary>
            <pre className="prompt-display">{metadata.prompt}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
