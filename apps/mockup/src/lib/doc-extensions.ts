import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { Markdown } from "@tiptap/markdown"
import { Link } from "@/components/editor"
import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { mentionExtension } from "@/lib/mention-extension"
import { LINK_KINDS } from "@/lib/mentions"
import { noteEmoji } from "@/lib/emoji-note"

// The one document editor Heed writes long text in is editorcn's toolbar editor with markdown in
// and out. These are the extensions every Heed document uses: headings 2 and 3, links, lists and
// quotes, no code blocks, and '@' links to context items, definitions and domains (navigation only:
// agents read a mention as its words). No emoji list here: agents read this text, so an emoji
// pasted in gets a quiet note instead, and stays if the writer means it.

export const docExtensions = (placeholder: string) => [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: false, codeBlock: false }),
  Link,
  Markdown,
  Placeholder.configure({ placeholder }),
  mentionExtension({ kinds: LINK_KINDS, empty: "Mention a context item, a definition or a domain." }),
  EmojiPasteNote,
]

/** A paste with an emoji in it says, quietly, that agents read it too. The paste goes ahead. */
const EmojiPasteNote = Extension.create({
  name: "emojiPasteNote",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handlePaste: (_view, event) => (noteEmoji(event.clipboardData?.getData("text/plain") ?? ""), false) } })]
  },
})
