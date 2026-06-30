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

    if (!isAllowedImageMime(file.type)) {
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
    if (!folder) {
      return NextResponse.json({ error: "Некорректная папка" }, { status: 400 });
    }

    const ext = extensionForMime(file.type);
    if (!ext) {
      return NextResponse.json({ error: "Неподдерживаемый формат" }, { status: 400 });
    }

    const basename = sanitizeUploadBasename(rawName);
    const filename = `${basename}-${Date.now()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "images", folder);

    fs.mkdirSync(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir, filename), buffer);

    return NextResponse.json({
      url: `/images/${folder}/${filename}`,
    });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
