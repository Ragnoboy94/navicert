"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadImage } from "./api";

export function ImageUpload({
  value,
  onChange,
  name,
  folder = "uploads",
  hint = "JPG, PNG, WebP или GIF, до 5 МБ",
  variant = "default",
}: {
  value?: string;
  onChange: (url: string | undefined) => void;
  name: string;
  folder?: string;
  hint?: string;
  variant?: "default" | "compact";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const { url } = await uploadImage(file, name, folder);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      className="hidden"
      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
    />
  );

  const uploadButton = (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={uploading}
      className={
        variant === "compact"
          ? "btn-ghost gap-1.5 px-3 py-1.5 text-sm"
          : "btn-primary gap-2 px-4 py-2 text-sm"
      }
    >
      {uploading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ImagePlus className="h-4 w-4" />
      )}
      {value ? "Заменить" : variant === "compact" ? "Добавить" : "Загрузить фото"}
    </button>
  );

  const removeButton = value ? (
    <button
      type="button"
      onClick={() => onChange(undefined)}
      disabled={uploading}
      className="btn-ghost gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
    >
      <Trash2 className="h-4 w-4" />
      Убрать
    </button>
  ) : null;

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {fileInput}
          {value && (
            <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-accent-soft">
              <Image
                key={value}
                src={value}
                alt=""
                fill
                className="object-cover"
                sizes="64px"
                unoptimized
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {uploadButton}
            {removeButton}
          </div>
          {hint && !error && (
            <span className="text-xs text-muted">{hint}</span>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {value ? (
        <div className="relative aspect-[16/10] max-w-md overflow-hidden rounded-xl border border-border bg-accent-soft">
          <Image
            key={value}
            src={value}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 400px"
            unoptimized
          />
        </div>
      ) : (
        <div className="flex aspect-[16/10] max-w-md items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted">
          Фото не выбрано
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {fileInput}
        {uploadButton}
        {removeButton}
      </div>

      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
