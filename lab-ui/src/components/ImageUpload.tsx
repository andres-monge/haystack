import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Only JPG, PNG, and WebP files are accepted";
  }
  if (file.size > MAX_SIZE) {
    return "File must be under 20 MB";
  }
  return null;
}

interface Props {
  onImageSelected: (file: File) => void;
  selectedImage: File | null;
}

export function ImageUpload({ onImageSelected, selectedImage }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke Object URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);

      // Revoke old Object URL, create new one
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);

      onImageSelected(file);
    },
    [onImageSelected],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div className="image-upload">
      <label className="section-label">Base Artwork</label>
      <div
        className={`drop-zone ${isDragOver ? "drag-over" : ""} ${selectedImage ? "has-image" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="upload-preview">
            <img src={previewUrl} alt="Selected artwork" />
            <span className="upload-filename">{selectedImage?.name}</span>
          </div>
        ) : (
          <div className="upload-placeholder">
            <span className="upload-icon">+</span>
            <span>Drop image here or click to select</span>
            <span className="upload-hint">JPG, PNG, WebP (max 20 MB)</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
