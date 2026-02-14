interface Props {
  value: string;
  defaultTemplate: string;
  scenarioPreview: string;
  onChange: (value: string) => void;
}

export function PromptEditor({
  value,
  defaultTemplate,
  scenarioPreview,
  onChange,
}: Props) {
  return (
    <div className="prompt-editor">
      <div className="prompt-header">
        <label className="section-label">Prompt</label>
        {value !== defaultTemplate && (
          <button
            className="btn-reset"
            onClick={() => onChange(defaultTemplate)}
          >
            Reset to default
          </button>
        )}
      </div>
      <div className="scenario-preview">
        Scenario: <em>{scenarioPreview || "—"}</em>
      </div>
      <textarea
        className="prompt-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
      />
    </div>
  );
}
