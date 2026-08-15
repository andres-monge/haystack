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

  const downloadExtension = metadata.mimeType === "image/jpeg"
    ? "jpg"
    : metadata.mimeType === "image/webp"
      ? "webp"
      : "png";

  return (
    <div className="preview-panel">
      <img
        className="preview-image"
        src={imageUrl}
        alt={`Generated at ${metadata.scenario.hour}:00`}
      />
      <div className="preview-actions">
        <button
          className="btn-details-toggle"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
        <a
          className="btn-download"
          href={`${imageUrl}?download=1`}
          download={`haystack-${metadata.id}.${downloadExtension}`}
        >
          Download
        </a>
      </div>
      {showDetails && (
        <div className="preview-metadata">
          <dl>
            {metadata.provider && (
              <>
                <dt>Provider</dt>
                <dd>{metadata.provider}</dd>
              </>
            )}
            <dt>Model</dt>
            <dd>{metadata.resolvedModel ?? metadata.model}</dd>
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
            {metadata.scenario.weatherSource && metadata.scenario.weatherSource !== "live" && (
              <>
                <dt>Weather</dt>
                <dd style={{ color: metadata.scenario.weatherSource === "none" ? "#e74c3c" : "#f39c12" }}>
                  {metadata.scenario.weatherSource === "cache"
                    ? "Cached (fetch failed)"
                    : "Missing (time-only scenario)"}
                </dd>
              </>
            )}
            {metadata.mimeType && (
              <>
                <dt>Format</dt>
                <dd>{metadata.mimeType.replace("image/", "").toUpperCase()}</dd>
              </>
            )}
            {metadata.width !== undefined && metadata.height !== undefined && (
              <>
                <dt>Dimensions</dt>
                <dd>{metadata.width} × {metadata.height}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
