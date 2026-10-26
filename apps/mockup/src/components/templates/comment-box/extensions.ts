import { Mention } from "@tiptap/extension-mention"
import { StarterKit } from "@tiptap/starter-kit"

// From the editorcn Comment Box's utils, apart so the store and the Inbox never load Tiptap.

/** What a comment can hold: paragraphs, bold, italic, inline code and lists. */
export const TEXT_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
  }),
]

/** The same, with mentions of people, for reading and copying a comment ("@Jon Abara"). The composer adds the '@' picker itself. */
export const EXTENSIONS = [...TEXT_EXTENSIONS, Mention.configure({ HTMLAttributes: { class: "mention" } })]
