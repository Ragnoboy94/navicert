export async function loadContent<T>(file: string): Promise<T> {
  const res = await fetch(`/api/admin/content?file=${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error("load failed");
  const json = await res.json();
  return json.data as T;
}

export async function saveContent(file: string, data: unknown): Promise<void> {
  const res = await fetch("/api/admin/content", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, data }),
  });
  if (!res.ok) throw new Error("save failed");
}

export async function loadLeads() {
  const res = await fetch("/api/admin/leads");
  if (!res.ok) return [];
  return res.json();
}

export async function uploadImage(
  file: File,
  name: string,
  folder = "uploads"
): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  formData.append("folder", folder);

  const res = await fetch("/api/admin/upload", {
    method: "POST",
    body: formData,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : "upload failed"
    );
  }

  return json as { url: string };
}
