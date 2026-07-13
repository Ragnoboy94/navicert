import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { isUploadFolder, uploadDir } from "./upload-paths";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export function serveUploadedImage(
  folder: string,
  segments: string[]
): NextResponse {
  if (!isUploadFolder(folder)) {
    return new NextResponse(null, { status: 404 });
  }

  const filename = path.basename(segments.join("/"));
  if (!filename || filename.includes("..")) {
    return new NextResponse(null, { status: 404 });
  }

  const baseDir = uploadDir(folder);
  const filePath = path.join(baseDir, filename);
  if (!filePath.startsWith(baseDir) || !fs.existsSync(filePath)) {
    return new NextResponse(null, { status: 404 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME[ext] ?? "application/octet-stream";

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
