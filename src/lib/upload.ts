const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function extensionForMime(mime: string): string | null {
  return ALLOWED_TYPES[mime] ?? null;
}

export function isAllowedImageMime(mime: string): boolean {
  return mime in ALLOWED_TYPES;
}

export function sanitizeUploadBasename(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return cleaned || "image";
}

export function sanitizeUploadFolder(folder: string): string | null {
  const cleaned = folder.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned;
}
