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
}: {
  value?: string;
  onChange: (url: string | undefined) => void;
  name: string;
  folder?: string;
  hint?: string;
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
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-primary gap-2 px-4 py-2 text-sm"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {value ? "Заменить фото" : "Загрузить фото"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={uploading}
            className="btn-ghost gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Убрать
          </button>
        )}
      </div>

      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
