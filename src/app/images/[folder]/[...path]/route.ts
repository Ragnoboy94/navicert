import { serveUploadedImage } from "@/lib/serve-uploaded-image";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ folder: string; path: string[] }> }
) {
  const { folder, path: segments } = await params;
  return serveUploadedImage(folder, segments);
}
