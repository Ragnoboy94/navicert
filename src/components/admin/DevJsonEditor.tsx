"use client";

import { useEffect, useState } from "react";
import { Save, Loader2, FileJson } from "lucide-react";
import { loadContent, saveContent } from "./api";

const contentLabels: Record<string, string> = {
  "site.json": "Настройки сайта",
  "services.json": "Услуги",
  "categories.json": "Категории продукции",
  "advantages.json": "Преимущества",
  "steps.json": "Этапы работы",
  "why-us.json": "Почему мы",
  "reviews.json": "Отзывы",
  "faq.json": "Вопросы и ответы",
  "cases.json": "Кейсы",
  "quiz.json": "Квиз подбора",
  "cities.json": "Города",
  "partners.json": "Партнёры",
  "clients.json": "Логотипы клиентов",
};

export function DevJsonEditor({ files }: { files: string[] }) {
  const [selectedFile, setSelectedFile] = useState("");
  const [editorValue, setEditorValue] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  async function loadFile(file: string) {
    setSelectedFile(file);
    const data = await loadContent(file);
    setEditorValue(JSON.stringify(data, null, 2));
    setSaveStatus("idle");
  }

  async function saveFile() {
    setSaveStatus("saving");
    try {
      JSON.parse(editorValue);
      await saveContent(selectedFile, JSON.parse(editorValue));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  }

  useEffect(() => {
    if (files.length && !selectedFile) loadFile(files[0]);
  }, [files]);

  return (
    <div>
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Режим для разработчика: редактирование сырого JSON. Для повседневной работы используйте разделы выше.
      </p>
      <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
        <div className="rounded-2xl border border-border bg-white p-2 shadow-sm">
          {files.map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => loadFile(file)}
              className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm ${
                selectedFile === file
                  ? "bg-accent-soft font-semibold text-primary"
                  : "text-muted hover:bg-background"
              }`}
            >
              {contentLabels[file] || file}
            </button>
          ))}
        </div>

        {selectedFile ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-bold">
                {contentLabels[selectedFile] || selectedFile}
              </h2>
              <button
                type="button"
                onClick={saveFile}
                disabled={saveStatus === "saving"}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saveStatus === "saving" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveStatus === "saved"
                  ? "Сохранено"
                  : saveStatus === "error"
                    ? "Ошибка JSON"
                    : "Сохранить"}
              </button>
            </div>
            <textarea
              value={editorValue}
              onChange={(e) => setEditorValue(e.target.value)}
              className="min-h-[50vh] w-full resize-none bg-[#1e293b] p-5 font-mono text-sm leading-relaxed text-green-100 outline-none"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-white p-8 text-muted">
            <FileJson className="mr-2 h-8 w-8 opacity-40" />
            Выберите файл
          </div>
        )}
      </div>
    </div>
  );
}
