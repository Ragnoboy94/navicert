import Paragraph from "@tiptap/extension-paragraph";

/** Абзац с опциональной красной строкой (class="prose-indent") */
export const ArticleParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: {
        default: false,
        parseHTML: (element) => element.classList.contains("prose-indent"),
        renderHTML: (attributes) =>
          attributes.indent ? { class: "prose-indent" } : {},
      },
    };
  },
});
