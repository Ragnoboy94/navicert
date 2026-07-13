import type { Editor } from "@tiptap/react";

function paragraphAtSelection(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "paragraph") {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

export function paragraphIndentActive(editor: Editor): boolean {
  const hit = paragraphAtSelection(editor);
  return Boolean(hit?.node.attrs.indent);
}

/** Красная строка: текущий абзац или все абзацы в выделении */
export function toggleParagraphIndent(editor: Editor): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const targets: { pos: number; indent: boolean }[] = [];

  if (!empty) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== "paragraph") return;
      targets.push({ pos, indent: Boolean(node.attrs.indent) });
    });
  } else {
    const hit = paragraphAtSelection(editor);
    if (hit) {
      targets.push({
        pos: hit.pos,
        indent: Boolean(hit.node.attrs.indent),
      });
    }
  }

  if (targets.length === 0) return false;

  const allIndented = targets.every((t) => t.indent);
  const next = !allIndented;

  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      for (const { pos } of targets) {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "paragraph") continue;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      }
      if (dispatch) dispatch(tr);
      return true;
    })
    .run();
}
