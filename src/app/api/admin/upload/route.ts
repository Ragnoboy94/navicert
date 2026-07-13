import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  extensionForMime,
  isAllowedImageMime,
  MAX_UPLOAD_BYTES,
  sanitizeUploadBasename,
  sanitizeUploadFolder,
} from "@/lib/upload";
import {
  isUploadFolder,
  uploadDir,
  uploadPublicUrl,
} from "@/lib/upload-paths";

function resolveImageMime(file: File): string | null {
  if (isAllowedImageMime(file.type)) {
    return file.type;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  const mime = ext ? byExt[ext] : undefined;
  return mime && isAllowedImageMime(mime) ? mime : null;
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const rawName = String(formData.get("name") || "image");
    const rawFolder = String(formData.get("folder") || "uploads");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }

    const mime = resolveImageMime(file);
    if (!mime) {
      return NextResponse.json(
        { error: "Допустимы JPG, PNG, WebP или GIF" },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Файл слишком большой (макс. 5 МБ)" },
        { status: 400 }
      );
    }

    const folder = sanitizeUploadFolder(rawFolder);
    if (!folder || !isUploadFolder(folder)) {
      return NextResponse.json({ error: "Некорректная папка" }, { status: 400 });
    }

    const ext = extensionForMime(mime);
    if (!ext) {
      return NextResponse.json({ error: "Неподдерживаемый формат" }, { status: 400 });
    }

    const basename = sanitizeUploadBasename(rawName);
    const filename = `${basename}-${Date.now()}.${ext}`;
    const dir = uploadDir(folder);

    fs.mkdirSync(dir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(dir, filename), buffer);

    return NextResponse.json({
      url: uploadPublicUrl(folder, filename),
    });
  } catch (error) {
    console.error("upload failed:", error);
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
