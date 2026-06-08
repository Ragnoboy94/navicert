import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  contentFiles,
  readContentFile,
  writeContentFile,
} from "@/lib/content";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    return NextResponse.json({ files: contentFiles });
  }

  try {
    const data = readContentFile(file);
    return NextResponse.json({ file, data });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { file, data } = await request.json();
    if (!file || data === undefined) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    writeContentFile(file, data);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
