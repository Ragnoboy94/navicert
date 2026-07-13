"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Eye,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Pencil,
  Pilcrow,
  Strikethrough,
} from "lucide-react";
import { ArticleBodyContent } from "@/components/ArticleBodyContent";
import {
  articleBodyToEditorHtml,
  isLegacyArticleMarkdown,
  normalizeArticleHtml,
} from "@/lib/article-body";
import { articleEditorExtensions } from "@/lib/tiptap/article-editor-extensions";
import {
  paragraphIndentActive,
  toggleParagraphIndent,
} from "@/lib/tiptap/toggle-paragraph-indent";
import { uploadImage } from "./api";

type MarkName = "bold" | "italic" | "strike";

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  indent: boolean;
  h2: boolean;
  h3: boolean;
  link: boolean;
  bullet: boolean;
  ordered: boolean;
};

const EMPTY_TOOLBAR: ToolbarState = {
  bold: false,
  italic: false,
  strike: false,
  indent: false,
  h2: false,
  h3: false,
  link: false,
  bullet: false,
  ordered: false,
};

function readToolbar(editor: Editor): ToolbarState {
  return {
    bold: markReallyActive(editor, "bold"),
    italic: markReallyActive(editor, "italic"),
    strike: markReallyActive(editor, "strike"),
    indent: paragraphIndentActive(editor),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    link: editor.isActive("link"),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
  };
}

function markReallyActive(editor: Editor, mark: MarkName): boolean {
  const { empty } = editor.state.selection;
  if (!empty) return editor.isActive(mark);
  return editor.state.selection.$from
    .marks()
    .some((m) => m.type.name === mark);
}

function toggleMark(editor: Editor, mark: MarkName) {
  const chain = editor.chain().focus();
  if (markReallyActive(editor, mark)) {
    chain.unsetMark(mark).run();
    return;
  }
  if (!editor.state.selection.empty) {
    chain.toggleMark(mark).run();
  }
}

function clearStoredMarks(editor: Editor) {
  if (editor.state.storedMarks?.length) {
    editor.view.dispatch(editor.state.tr.setStoredMarks([]));
  }
}

function ToolbarButton({
  active,
  title,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted hover:bg-white hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 hidden h-8 w-px shrink-0 bg-border sm:block" />;
}

export function ArticleRichEditor({
  value,
  onChange,
  slug,
}: {
  value: string;
  onChange: (value: string) => void;
  slug: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [toolbar, setToolbar] = useState<ToolbarState>(EMPTY_TOOLBAR);
  const slugRef = useRef(slug);
  const skipExternalSync = useRef(false);
  const toolbarFrame = useRef(0);
  slugRef.current = slug;

  const legacyMarkdown = useMemo(() => isLegacyArticleMarkdown(value), [value]);
  const editorHtml = useMemo(() => articleBodyToEditorHtml(value), [value]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: articleEditorExtensions,
    content: editorHtml,
    editorProps: {
      attributes: {
        class: "article-rich-editor prose-content focus:outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      skipExternalSync.current = true;
      const html = normalizeArticleHtml(ed.getHTML());
      onChange(html === "<p></p>" || html === "<p><br></p>" ? "" : html);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      clearStoredMarks(ed);
      cancelAnimationFrame(toolbarFrame.current);
      toolbarFrame.current = requestAnimationFrame(() => {
        setToolbar(readToolbar(ed));
      });
    },
  });

  useEffect(() => {
    if (!editor) return;
    setToolbar(readToolbar(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (skipExternalSync.current) {
      skipExternalSync.current = false;
      return;
    }
    const current = editor.getHTML();
    if (current !== editorHtml) {
      editor.commands.setContent(editorHtml, { emitUpdate: false });
    }
  }, [editor, editorHtml]);

  useEffect(() => {
    return () => cancelAnimationFrame(toolbarFrame.current);
  }, []);

  async function insertImage() {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:0;height:0;opacity:0;pointer-events:none;";

    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      setUploading(true);
      setError(null);
      try {
        const { url } = await uploadImage(file, slugRef.current, "articles");
        editor.chain().focus().setImage({ src: url, alt: "Фото" }).run();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить");
      } finally {
        setUploading(false);
      }
    };

    document.body.appendChild(input);
    input.click();
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Ссылка (https://… или /uslugi/…)", prev || "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url.trim() })
      .run();
  }

  function toggleIndent() {
    if (!editor) return;
    toggleParagraphIndent(editor);
  }

  if (!editor) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="article-editor-shell flex min-h-[14rem] items-center justify-center px-4 py-8 text-sm text-muted">
          Загружаем редактор…
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      {legacyMarkdown && !preview && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Старая статья в Markdown. Текст загружен для редактирования — после сохранения
          будет HTML, как в новом редакторе.
        </div>
      )}
      <div className="flex flex-col gap-2 border-b border-border bg-background px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className={`flex min-w-0 flex-1 flex-wrap items-center gap-0.5 ${
            preview ? "pointer-events-none opacity-40" : ""
          }`}
        >
          <ToolbarButton
            title="Жирный — выделите слово"
            active={toolbar.bold}
            disabled={preview}
            onClick={() => toggleMark(editor, "bold")}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Курсив — выделите слово"
            active={toolbar.italic}
            disabled={preview}
            onClick={() => toggleMark(editor, "italic")}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Зачёркнутый"
            active={toolbar.strike}
            disabled={preview}
            onClick={() => toggleMark(editor, "strike")}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            title="Красная строка"
            active={toolbar.indent}
            disabled={preview}
            onClick={toggleIndent}
          >
            <Pilcrow className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Заголовок 2"
            active={toolbar.h2}
            disabled={preview}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Заголовок 3"
            active={toolbar.h3}
            disabled={preview}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Ссылка"
            active={toolbar.link}
            disabled={preview}
            onClick={setLink}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Список"
            active={toolbar.bullet}
            disabled={preview}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Нумерованный список"
            active={toolbar.ordered}
            disabled={preview}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Разделитель"
            disabled={preview}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Вставить фото"
            disabled={preview}
            onClick={() => void insertImage()}
          >
            <ImagePlus className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <div className="flex shrink-0 items-center gap-1 self-end border-border sm:self-auto sm:border-l sm:pl-2">
          <ToolbarButton
            title="Редактирование"
            active={!preview}
            onClick={() => setPreview(false)}
          >
            <Pencil className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            title="Как на сайте"
            active={preview}
            onClick={() => setPreview(true)}
          >
            <Eye className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      {preview ? (
        <div className="article-editor-shell min-h-[14rem] bg-white px-4 py-3">
          {value?.trim() ? (
            <ArticleBodyContent text={value} />
          ) : (
            <p className="text-sm text-muted">Текст появится здесь — как на странице /blog/…</p>
          )}
        </div>
      ) : (
        <div className="article-editor-shell min-h-[14rem] bg-white">
          <EditorContent editor={editor} />
        </div>
      )}

      {(uploading || error) && (
        <div className="border-t border-border bg-background px-3 py-2 text-xs">
          {uploading && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Загружаем фото…
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      )}
    </div>
  );
}
