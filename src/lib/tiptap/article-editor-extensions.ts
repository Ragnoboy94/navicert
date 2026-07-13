import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { ArticleParagraph } from "./article-paragraph";

/** Общие расширения Tiptap для редактора статей (синглтон — не пересоздавать на каждый рендер) */
export const articleEditorExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    paragraph: false,
  }),
  ArticleParagraph,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      class: "text-primary underline decoration-primary/30 underline-offset-2",
    },
  }),
  Image.configure({ inline: false }),
  Placeholder.configure({
    placeholder:
      "Пишите текст. Выделите слово → B для жирного. Пробелы сохраняются.",
  }),
];
