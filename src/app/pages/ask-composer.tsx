import * as React from 'react'
import type { JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { ArrowUpIcon, AtSignIcon, SquareIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { QuestionPart } from '@/data/ask'
import { emojiExtension, mentionExtension, mentionOpen } from '@/lib/mention-extension'
import { SCOPE_KINDS, type MentionRef } from '@/lib/mentions'
import { inputSurface } from '@/lib/surfaces'

// The Ask composer: the soft input surface the comment box uses (lib/surfaces.ts), the words on
// top and a thin control row under a hairline. Typing '@' scopes the question to a domain, a
// definition, a context item or a market, as chips in the words; that replaced the Read as menus.
// Enter sends (unless the '@' list is open), Shift and Enter make a new line. Loaded on demand,
// so the editor stays out of the first page load.

export type AskQuestion = { text: string; parts: QuestionPart[]; scope: MentionRef[] }

/** What the box can be told to hold: words and mentions, as a question would be asked again. */
export type ComposerHandle = { set: (parts: QuestionPart[]) => void; focus: () => void }

const toContent = (parts: QuestionPart[]): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: parts
        .filter((p) => p !== '')
        .map((p) =>
          typeof p === 'string'
            ? { type: 'text', text: p }
            : { type: 'mention', attrs: { id: p.id, label: p.label } },
        ),
    },
  ],
})

/** The box's words and mentions in order, a new line between paragraphs. */
function read(doc: JSONContent): AskQuestion {
  const parts: QuestionPart[] = []
  const push = (p: QuestionPart) => {
    const last = parts[parts.length - 1]
    if (typeof p === 'string' && typeof last === 'string') parts[parts.length - 1] = last + p
    else parts.push(p)
  }
  doc.content?.forEach((para, i) => {
    if (i > 0) push('\n')
    para.content?.forEach((n) => {
      if (n.type === 'text') push(n.text ?? '')
      else if (n.type === 'hardBreak') push('\n')
      else if (n.type === 'mention')
        push({ id: n.attrs?.id as string, label: n.attrs?.label as string })
    })
  })
  // One space around a chip, never two (a chip brings its own).
  for (let i = 0; i < parts.length; i++)
    if (typeof parts[i] === 'string') parts[i] = (parts[i] as string).replace(/ {2,}/g, ' ')
  const text = parts
    .map((p) => (typeof p === 'string' ? p : p.label))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
  const scope = parts.filter((p): p is MentionRef => typeof p !== 'string')
  return { text, parts, scope: scope.filter((m, i) => scope.findIndex((x) => x.id === m.id) === i) }
}

export function AskComposer({
  onSubmit,
  onStop,
  busy,
  placeholder,
  prefill,
  autoFocus,
  ref,
}: {
  onSubmit: (q: AskQuestion) => void
  onStop: () => void
  busy: boolean
  placeholder: string
  prefill?: string
  autoFocus?: boolean
  ref?: React.Ref<ComposerHandle>
}) {
  const send = React.useRef<() => void>(() => undefined)
  const escape = React.useRef<() => boolean>(() => false)
  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? 'end' : false,
    content: prefill ? toContent([prefill]) : '',
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      mentionExtension({
        kinds: SCOPE_KINDS,
        empty: 'Mention a domain, a definition, a context item or a market.',
      }),
      // Low-key here: no button, only ':' and two letters, for someone who types emoji anyway.
      emojiExtension(),
    ],
    editorProps: {
      attributes: {
        'aria-label': 'Ask a question',
        'aria-keyshortcuts': '/',
        // Where the page's skip link lands: the box to ask in.
        'data-skip-target': '',
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'max-h-48 min-h-14 overflow-y-auto px-3 py-3 text-base leading-6 outline-none',
      },
      handleKeyDown: (view, e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mentionOpen(view.state)) {
          e.preventDefault()
          send.current()
          return true
        }
        // Escape stops an answer being written; with the @ list open it closes the list first.
        if (e.key === 'Escape' && !mentionOpen(view.state) && escape.current()) {
          e.preventDefault()
          return true
        }
        return false
      },
    },
  })
  const empty =
    useEditorState({ editor, selector: ({ editor: e }) => !e || e.isDestroyed || e.isEmpty }) ??
    true

  // Enter while an answer is still being written says so, instead of doing nothing.
  const [held, setHeld] = React.useState(false)
  const holdTimer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(holdTimer.current), [])
  const submit = React.useCallback(() => {
    if (!editor) return
    if (busy) {
      setHeld(true)
      window.clearTimeout(holdTimer.current)
      holdTimer.current = window.setTimeout(() => setHeld(false), 2500)
      return
    }
    const q = read(editor.getJSON())
    if (!q.text) return
    onSubmit(q)
    editor.commands.clearContent()
  }, [editor, busy, onSubmit])
  React.useEffect(() => {
    escape.current = () => {
      if (busy) onStop()
      return busy
    }
  })
  React.useEffect(() => {
    send.current = submit
  }, [submit])

  React.useImperativeHandle(
    ref,
    () => ({
      set: (parts) => editor?.chain().setContent(toContent(parts)).focus('end').run(),
      focus: () => editor?.commands.focus('end'),
    }),
    [editor],
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}
      className={cn('ask-composer flex w-full cursor-text flex-col', inputSurface)}
    >
      <EditorContent editor={editor} />
      <div className="flex h-10 items-center gap-2 border-t px-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Mention a domain, a definition, a context item or a market"
                className="text-muted-foreground"
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent(
                      editor.state.selection.$from.nodeBefore?.text?.endsWith(' ') === false
                        ? ' @'
                        : '@',
                    )
                    .run()
                }
              />
            }
          >
            <AtSignIcon />
          </TooltipTrigger>
          <TooltipContent>Scope it with @</TooltipContent>
        </Tooltip>
        <span role="status" className="min-w-0 truncate text-xs text-muted-foreground">
          {held && busy ? 'Still answering. Stop it to ask now.' : ''}
        </span>
        <span
          className={cn(
            'ml-auto hidden shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground @xl:flex',
            held && busy && '@xl:hidden',
          )}
        >
          <Kbd>@</Kbd> to scope - <Kbd>Enter</Kbd> to send - <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a
          new line
        </span>
        {busy ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Stop"
            className="shrink-0 @max-xl:ml-auto"
            onClick={onStop}
          >
            <SquareIcon className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Ask"
            disabled={empty}
            className="shrink-0 @max-xl:ml-auto"
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  )
}
