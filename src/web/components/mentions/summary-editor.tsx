import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { AllSelection, NodeSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { closeHistory, redo, undo } from 'prosemirror-history'
import { CircleHelpIcon } from '@/components/icons'
import { ChipSlots, MentionView, syncSelection } from '@/components/mentions/mention-view'
import { MentionChip } from '@/components/item/mention-chip'
import { PreviewTrigger } from '@/components/preview/preview-trigger'
import { chipTargetOf } from '@/components/mentions/mention-text'
import {
  ENTITY_TYPES,
  MentionPickerPopup,
  useMentionPicker,
  type MentionPicker,
} from '@/components/mentions/mention-picker'
import { TextCheckNote } from '@/components/editor/text-check-note'
import { textCheckDecorations, textCheckMatches } from '@/components/editor/text-check'
import {
  acceptSuggestion,
  createSummaryState,
  docToMarkup,
  findSuggestions,
  findTrigger,
  insertMention,
  clipboardHtml,
  MARKUP_MIME,
  markupFromHtml,
  mentionCount,
  mentionToText,
  MENTIONS_MAX,
  pasteTransaction,
  removeMention,
  selectionMarkup,
  selectionText,
  splitPaste,
  docText,
  type Suggestion,
  type Trigger,
} from '@/components/mentions/summary-doc'
import type { SummaryEditorProps } from '@/components/mentions/summary-input'
import { Button } from '@/components/ui/button'
import type { MentionStatus } from '@/lib/mention-names'
import { targetsByKey, type MentionOption } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'
import { cn } from '@/lib/utils'

/*
  The summary field (contract 9.6, decided by the spike in docs/design/chip-input.md): one
  ProseMirror paragraph of text and mention atoms. ProseMirror owns the text, the selection and
  the undo history; React owns the chips (rendered into each atom with a portal, so the chip is
  the one MentionChip component), the @ list and the suggestion line.
*/

/** A recognised word is underlined, dotted. */
function suggestionDecorations(suggestions: Suggestion[]) {
  return suggestions.map((suggestion) =>
    Decoration.inline(suggestion.from, suggestion.to, {
      class: 'underline decoration-dotted decoration-muted-foreground underline-offset-4',
    }),
  )
}

export default function SummaryEditor({
  value,
  onChange,
  targets,
  pending,
  statuses,
  onRequestTerm,
  id,
  listId,
  placeholder,
  disabled,
  invalid,
  describedBy,
  labelledBy,
  label,
  appearance = 'field',
  max,
  onOverflow,
  onLeave,
  checkText = false,
}: SummaryEditorProps & { targets: MentionOption[]; pending: boolean; listId: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [slots] = useState(() => new ChipSlots())
  const chips = useSyncExternalStore(slots.subscribe, slots.getSnapshot, slots.getSnapshot)
  const [editorState, setEditorState] = useState<EditorState>(() => createSummaryState(value))
  const [declined, setDeclined] = useState<ReadonlySet<string>>(() => new Set())
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const lastMarkup = useRef(value)
  const disabledRef = useRef(disabled)
  const onChangeRef = useRef(onChange)
  const edgeRef = useRef({ onOverflow, onLeave, max })
  const [moved, setMoved] = useState(false)
  useEffect(() => {
    onChangeRef.current = onChange
    edgeRef.current = { onOverflow, onLeave, max }
  }, [onChange, onOverflow, onLeave, max])

  const dispatch = useCallback((tr: Transaction) => {
    const view = viewRef.current
    if (!view) return
    const next = view.state.apply(tr)
    view.updateState(next)
    setEditorState(next)
    if (tr.docChanged) {
      if (tr.getMeta('uiEvent') !== 'paste') setMoved(false)
      const markup = docToMarkup(next.doc)
      if (markup !== lastMarkup.current) {
        lastMarkup.current = markup
        onChangeRef.current(markup)
      }
    }
  }, [])

  const lookup = targetsByKey(targets)
  const rawTrigger = focused ? findTrigger(editorState) : null
  const full = mentionCount(editorState.doc) >= MENTIONS_MAX
  // The list's own state; the keys and the owner request read it through a ref.
  const pickerRef = useRef<MentionPicker<Trigger & { at: number }> | null>(null)
  const picker = useMentionPicker({
    listId,
    targets,
    trigger: rawTrigger && { ...rawTrigger, at: rawTrigger.from },
    types: ENTITY_TYPES,
    full,
    row:
      onRequestTerm && !full
        ? ({ trigger: at, matches }) => {
            const words = at.query.trim()
            return {
              label:
                words && matches.length === 0
                  ? `Ask an owner to add “${words}”`
                  : 'Not in the list? Ask an owner to add it',
              onChoose: () => {
                onRequestTerm(words)
                pickerRef.current?.dismiss()
                viewRef.current?.focus()
              },
            }
          }
        : undefined,
    onPick: (option, at) => {
      const view = viewRef.current
      if (!view) return
      dispatch(insertMention(view.state, at, option))
      view.focus()
    },
  })
  const { trigger, open } = picker

  const suggestions = useMemo(
    () =>
      findSuggestions(editorState.doc, targets).filter(
        (suggestion) => !declined.has(suggestion.words.toLocaleLowerCase('en')),
      ),
    [editorState.doc, targets, declined],
  )
  const suggestion = trigger ? undefined : suggestions[0]
  const checks = useMemo(
    () => (checkText ? textCheckMatches(editorState.doc) : []),
    [checkText, editorState.doc],
  )
  const check = checks[0]
  const checkId = `${listId}-check`

  // Keyboard handling reads the latest list through a ref, so the view is created once.
  useEffect(() => {
    pickerRef.current = picker
  })

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const view: EditorView = new EditorView(mount, {
      state: createSummaryState(lastMarkup.current),
      dispatchTransaction: (tr) => dispatch(tr),
      nodeViews: { mention: (node) => new MentionView(node, slots) },
      handleKeyDown: (view, event) => {
        syncSelection(view)
        // Enter with no row to take is still the list's: the summary is one block.
        const key = pickerRef.current?.keyDown(event.key)
        if (key === 'handled') return true
        if (key === 'empty') return event.key === 'Enter'
        const { selection } = view.state
        const mod = event.metaKey || event.ctrlKey
        if (mod && !event.altKey && event.key.toLowerCase() === 'z')
          return (event.shiftKey ? redo : undo)(view.state, view.dispatch)
        if (mod && !event.altKey && event.key.toLowerCase() === 'y')
          return redo(view.state, view.dispatch)
        // Select all in the editor's own state at once, so a copy or cut right after it sees it.
        if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
          view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
          return true
        }
        // One block: Enter never adds a line. On a page it goes on to the text below.
        const edge = edgeRef.current
        if (event.key === 'Enter') {
          if (!mod) edge.onLeave?.('next')
          return true
        }
        if (edge.onLeave && !mod && !event.shiftKey && !event.altKey && selection.empty) {
          if (event.key === 'ArrowDown' && view.endOfTextblock('down')) {
            edge.onLeave('next')
            return true
          }
          if (event.key === 'ArrowUp' && view.endOfTextblock('up')) {
            edge.onLeave('previous')
            return true
          }
        }
        // A selected chip: Delete turns it back into its words, Backspace removes it whole.
        if (selection instanceof NodeSelection && event.key === 'Delete') {
          const tr = mentionToText(view.state, selection.from)
          if (tr) view.dispatch(tr)
          return true
        }
        if (!selection.empty && (event.key === 'Backspace' || event.key === 'Delete')) {
          view.dispatch(closeHistory(view.state.tr).deleteSelection().scrollIntoView())
          return true
        }
        if (selection.empty && (event.key === 'Backspace' || event.key === 'Delete')) {
          const $pos = selection.$from
          const node = event.key === 'Backspace' ? $pos.nodeBefore : $pos.nodeAfter
          const tr =
            node && !node.isText
              ? removeMention(view.state, event.key === 'Backspace' ? $pos.pos - 1 : $pos.pos)
              : null
          if (tr) {
            view.dispatch(tr)
            return true
          }
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const text = data.getData('text/plain')
        const markup = data.getData(MARKUP_MIME) || markupFromHtml(data.getData('text/html'))
        const { onOverflow: overflow, max: limit } = edgeRef.current
        // A paste longer than the summary holds keeps what fits, to a sentence end, and moves
        // the rest into the text below instead of failing (the editor design, section 3).
        const room =
          limit === undefined
            ? Infinity
            : limit - [...docText(view.state.doc)].length + [...selectionText(view.state)].length
        const split = overflow && !markup ? splitPaste(text, room) : null
        if (split) {
          view.dispatch(pasteTransaction(view.state, { text: split.head }))
          if (split.rest && overflow) {
            overflow(split.rest)
            setMoved(true)
          }
          return true
        }
        view.dispatch(pasteTransaction(view.state, { text, markup }))
        return true
      },
      // Dropping text or a chip by drag is not offered; cut and paste does the same by keyboard.
      handleDrop: () => true,
      handleDOMEvents: {
        copy: (view, event) => copyOrCut(view, event, false),
        cut: (view, event) => copyOrCut(view, event, true),
        focus: () => {
          setFocused(true)
          return false
        },
        blur: () => {
          setFocused(false)
          return false
        },
      },
      editable: () => !disabledRef.current,
    })
    viewRef.current = view
    setEditorState(view.state)
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [dispatch, slots])

  // A value set from outside (a reset, a server rebase) replaces the text; history starts over.
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === lastMarkup.current) return
    lastMarkup.current = value
    const next = createSummaryState(value)
    view.updateState(next)
    setEditorState(next)
  }, [value])

  useEffect(() => {
    disabledRef.current = disabled
    viewRef.current?.setProps({})
  }, [disabled])

  // The view's own attributes: a text field that suggests from a list.
  useEffect(() => {
    viewRef.current?.setProps({
      attributes: {
        ...(id ? { id } : {}),
        role: 'textbox',
        'aria-multiline': 'false',
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        'aria-controls': listId,
        ...(picker.activeDescendant ? { 'aria-activedescendant': picker.activeDescendant } : {}),
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
        ...(label ? { 'aria-label': label } : {}),
        ...(describedBy || check
          ? { 'aria-describedby': [describedBy, check ? checkId : ''].filter(Boolean).join(' ') }
          : {}),
        ...(invalid || check ? { 'aria-invalid': 'true' } : {}),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        ...(placeholder ? { 'aria-placeholder': placeholder } : {}),
        spellcheck: 'true',
        class:
          appearance === 'field'
            ? 'min-h-control-lg w-full px-3 py-2 break-words whitespace-break-spaces outline-none [font-variant-ligatures:none]'
            : 'min-h-control-md w-full break-words whitespace-break-spaces outline-none [font-variant-ligatures:none]',
      },
      decorations: (state) =>
        DecorationSet.create(state.doc, [
          ...suggestionDecorations(suggestions),
          ...textCheckDecorations(checks),
        ]),
    })
  })

  // Where the list opens: under the @, kept inside the field's width.
  useLayoutEffect(() => {
    const view = viewRef.current
    const wrapper = wrapperRef.current
    if (!open || !view || !wrapper || !trigger) {
      setPosition(null)
      return
    }
    const coords = view.coordsAtPos(trigger.from)
    const box = wrapper.getBoundingClientRect()
    setPosition({ left: coords.left - box.left, top: coords.bottom - box.top })
  }, [open, trigger?.from, editorState]) // eslint-disable-line react-hooks/exhaustive-deps

  const empty = editorState.doc.content.size <= 2

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        data-slot="summary-input"
        data-disabled={disabled || undefined}
        aria-invalid={invalid || undefined}
        data-appearance={appearance}
        className={cn(
          'relative w-full cursor-text text-large data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_[data-selected]]:selection:bg-transparent [&_[data-selected]>[data-slot=mention-chip]]:ring-2 [&_[data-selected]>[data-slot=mention-chip]]:ring-ring',
          appearance === 'field' &&
            'rounded-md border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30',
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault()
            viewRef.current?.focus()
          }
        }}
      >
        {empty && placeholder ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 text-muted-foreground',
              appearance === 'field' && 'px-3 py-2',
            )}
          >
            {placeholder}
          </span>
        ) : null}
        <div ref={mountRef} />
      </div>
      {chips.map((chip) => {
        const option = lookup.get(chip.target)
        const status: MentionStatus = statuses?.[chip.target] ?? option?.status ?? 'current'
        const missing = !option && !pending && !statuses?.[chip.target]
        const preview =
          missing || status === 'retired' || status === 'source_missing'
            ? null
            : previewTargetOf(chip.target)
        const view = (
          <MentionChip
            target={chipTargetOf(chip.target, option)}
            name={chip.label}
            missing={missing}
            status={status}
            hint={!preview}
          />
        )
        // A chip in the text previews on hover; a click or a tap keeps selecting it, as before.
        return createPortal(
          preview ? (
            <PreviewTrigger preview={preview} render={<span />} sheet={false}>
              {view}
            </PreviewTrigger>
          ) : (
            view
          ),
          chip.dom,
          chip.id,
        )
      })}
      <MentionPickerPopup
        picker={picker}
        point={position}
        label={
          trigger?.char === '#' ? 'Mention a value' : 'Mention a metric, value, fact or domain'
        }
        closedLabel="Mentions"
        empty={
          full
            ? `At most ${MENTIONS_MAX} mentions in one field. Remove one to add another.`
            : pending
              ? 'Loading the names…'
              : undefined
        }
      />
      {suggestion ? (
        <div
          data-slot="mention-suggestion"
          className="flex flex-wrap items-center gap-2 px-3 py-1 text-dense text-muted-foreground"
        >
          <CircleHelpIcon aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="min-w-0 flex-1">
            Make <b className="font-bold text-foreground">{suggestion.words}</b> a mention?
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const view = viewRef.current
              if (!view) return
              dispatch(acceptSuggestion(view.state, suggestion))
              view.focus()
            }}
          >
            Yes
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setDeclined((words) => new Set([...words, suggestion.words.toLocaleLowerCase('en')]))
            }
          >
            No
          </Button>
        </div>
      ) : null}
      {check ? (
        <TextCheckNote
          id={checkId}
          code={check.code}
          more={checks.length - 1}
          onRemove={() => {
            const view = viewRef.current
            if (!view) return
            dispatch(closeHistory(view.state.tr).delete(check.from, check.to).scrollIntoView())
            view.focus()
          }}
        />
      ) : null}
      {moved ? (
        <p className="px-3 py-1 text-dense text-muted-foreground" role="status">
          The summary holds {max} characters. The rest of the paste moved into the text below.
        </p>
      ) : null}
    </div>
  )
}

/** Copy writes the words as plain text and the markup in its own type, so chips survive a paste here. */
function copyOrCut(view: EditorView, event: ClipboardEvent, cut: boolean) {
  const data = event.clipboardData
  if (!data || view.state.selection.empty) return false
  const markup = selectionMarkup(view.state)
  data.clearData()
  const text = selectionText(view.state)
  data.setData('text/plain', text)
  data.setData('text/html', clipboardHtml(text, markup))
  data.setData(MARKUP_MIME, markup)
  event.preventDefault()
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
  return true
}
