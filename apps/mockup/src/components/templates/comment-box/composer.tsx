import * as React from "react"
import type { JSONContent } from "@tiptap/core"
import Placeholder from "@tiptap/extension-placeholder"
import { useEditor, useEditorState } from "@tiptap/react"
import { cn } from "cn"
import { RichTextEditor } from "@/components/editor"
import { PersonAvatar } from "@/components/heed/bits"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { inputSurface } from "@/lib/surfaces"
import { emojiExtension, mentionExtension, mentionOpen } from "@/lib/mention-extension"
import { PEOPLE_KINDS } from "@/lib/mentions"
import { TEXT_EXTENSIONS } from "./extensions"

// From the editorcn Comment Box's composer, adapted to the trimmed editor and the flat style: one
// quiet line until it is used, then four controls (bold, italic, code, a list) and the keys. The
// textbox has a name (the template's had none), and the keys use the app's Kbd, which keeps 4.5:1.

export function Composer({
  author,
  label,
  placeholder,
  submitLabel = "Comment",
  initialContent,
  autoFocus = false,
  avatar = true,
  onPost,
  onCancel,
  onDraft,
  clearOnPost = true,
  postDisabled = false,
  className,
}: {
  author: string
  /** The textbox's accessible name: "Write a comment", "Reply to Lars". */
  label: string
  placeholder: string
  submitLabel?: string
  initialContent?: JSONContent
  autoFocus?: boolean
  avatar?: boolean
  onPost: (content: JSONContent) => void
  /** Esc or Cancel; it gets what was written, so the caller can keep it as a draft. */
  onCancel?: (draft: JSONContent | null) => void
  /** Every change to what is written, so a caller can keep a draft however the composer closes. */
  onDraft?: (draft: JSONContent | null) => void
  /** False keeps the words after Post: the caller closes the composer once the post went through. */
  clearOnPost?: boolean
  /** Posting waits (offline, or already sending); the words can still be written. */
  postDisabled?: boolean
  className?: string
}) {
  const draftRef = React.useRef(onDraft)
  React.useEffect(() => {
    draftRef.current = onDraft
  }, [onDraft])
  const handlers = React.useRef<{ cancel?: () => void; post: () => void } | null>(null)
  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: initialContent ?? "",
    editorProps: {
      attributes: { "aria-label": label, "aria-multiline": "true", role: "textbox" },
      handleKeyDown: (view, event) => {
        // An open '@' list takes its keys first.
        if (mentionOpen(view.state)) return false
        if (event.key === "Escape" && handlers.current?.cancel) {
          handlers.current.cancel()
          return true
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          handlers.current?.post()
          return true
        }
        return false
      },
    },
    extensions: [
      ...TEXT_EXTENSIONS,
      mentionExtension({ kinds: PEOPLE_KINDS, empty: "Mention anyone signed in to the workspace." }),
      // People talking to each other: ':' and two letters offers emoji.
      emojiExtension(),
      Placeholder.configure({ placeholder }),
    ],
    onUpdate: ({ editor: e }) => draftRef.current?.(e.isEmpty ? null : e.getJSON()),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
  })
  const empty = useEditorState({ editor, selector: ({ editor: e }) => !e || e.isEmpty }) ?? true
  const [focused, setFocused] = React.useState(autoFocus)

  const post = React.useCallback(() => {
    if (!editor || editor.isDestroyed || editor.isEmpty || postDisabled) return
    onPost(editor.getJSON())
    if (clearOnPost) editor.commands.clearContent()
  }, [editor, onPost, clearOnPost, postDisabled])
  const cancel = React.useMemo(
    () => (onCancel ? () => onCancel(editor && !editor.isDestroyed && !editor.isEmpty ? editor.getJSON() : null) : undefined),
    [onCancel, editor]
  )
  React.useEffect(() => {
    handlers.current = { cancel, post }
  }, [cancel, post])

  const mod = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "") ? "⌘" : "Ctrl"
  // Open while it has focus, holds words, or is an edit or a reply (they have a Cancel).
  const open = focused || !empty || !!onCancel

  return (
    <div className={cn("flex gap-3", className)}>
      {avatar && <PersonAvatar name={author} className="mt-1 hidden shrink-0 sm:flex" />}
      <RichTextEditor editor={editor} variant="compact" className={cn("min-w-0 flex-1 shadow-none!", inputSurface)}>
        <div onFocus={() => setFocused(true)} onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null) && setFocused(false)}>
          <RichTextEditor.Content className="[&_.ProseMirror]:min-h-9! [&_.ProseMirror]:px-3! [&_.ProseMirror]:py-2! [&_.ProseMirror]:text-base sm:[&_.ProseMirror]:text-sm" />
        </div>
        {open && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-1.5 py-1.5">
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Bold />
              <RichTextEditor.Italic />
              <RichTextEditor.Code />
              <RichTextEditor.BulletList />
            </RichTextEditor.ControlsGroup>
            <div className="ml-auto flex items-center gap-2">
              <KbdGroup className="hidden text-xs text-muted-foreground sm:inline-flex">
                <Kbd>{mod}</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              {onCancel && (
                <Button variant="ghost" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              )}
              <Button size="sm" disabled={empty || postDisabled} onClick={post}>
                {submitLabel}
              </Button>
            </div>
          </div>
        )}
      </RichTextEditor>
    </div>
  )
}
