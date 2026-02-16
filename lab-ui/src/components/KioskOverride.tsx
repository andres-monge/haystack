import { useCallback, useEffect, useRef, useState } from "react";
import { postOverride } from "../api/client";
import type { OverrideResult } from "../types";

interface Props {
  onResult: (result: OverrideResult) => void;
}

export function KioskOverride({ onResult }: Props) {
  const [scenario, setScenario] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Clean up success flash timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = scenario.trim();
    if (!text) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setIsSending(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await postOverride(text);
      setSuccess(true);
      onResult(result);
      timerRef.current = setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Override failed");
    } finally {
      setIsSending(false);
    }
  }, [scenario, onResult]);

  return (
    <div className="kiosk-override">
      <label className="section-label">Kiosk Override</label>
      <textarea
        className="override-textarea"
        placeholder="Describe a scenario (e.g., 'A thunderstorm at sunset with dramatic lightning')"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        rows={3}
        disabled={isSending}
      />
      <button
        className="btn-override"
        disabled={!scenario.trim() || isSending}
        onClick={handleSend}
      >
        {isSending ? "Sending..." : "Send Override"}
      </button>
      {success && (
        <span className="override-success">Override sent successfully</span>
      )}
      {error && <span className="override-error">{error}</span>}
    </div>
  );
}
