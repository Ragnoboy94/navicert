import path from "path";

export const UPLOAD_FOLDERS = ["uploads", "articles"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export function isUploadFolder(folder: string): folder is UploadFolder {
  return (UPLOAD_FOLDERS as readonly string[]).includes(folder);
}

export function uploadDir(folder: UploadFolder): string {
  return path.join(process.cwd(), "public", "images", folder);
}

export function uploadPublicUrl(folder: UploadFolder, filename: string): string {
  return `/images/${folder}/${filename}`;
}
