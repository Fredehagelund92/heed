// editorcn's toolbar editor (https://editorcn.vercel.app), trimmed for Heed: no bubble menu, no
// code blocks (and so no highlight.js), no embeds. Markdown goes in and out through @tiptap/markdown.
export { RichTextEditor } from "./rte-text-editor";
export { useRichTextEditorContext } from "./rte-context";
export type { RichTextEditorProps } from "./types";
export type { RichTextEditorVariant } from "./types";
export type { RichTextEditorFooterProps, WordCountInfo } from "./types";
export type { RichTextEditorLabels } from "./labels";
export { DEFAULT_LABELS } from "./labels";
export type { RichTextEditorIcons } from "./icon-types";
export { DEFAULT_ICONS } from "./icons";
export { Link } from "./extensions";
