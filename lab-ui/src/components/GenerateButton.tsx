interface Props {
  disabled: boolean;
  isGenerating: boolean;
  onClick: () => void;
}

export function GenerateButton({ disabled, isGenerating, onClick }: Props) {
  return (
    <button
      className="btn-generate"
      disabled={disabled || isGenerating}
      onClick={onClick}
    >
      {isGenerating ? "Generating..." : "Generate & Preview"}
    </button>
  );
}
