import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import type { Node as ProseNode } from 'prosemirror-model'
import {
  AllSelection,
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state'
import { DecorationSet, Decoration, EditorView, type NodeView } from 'prosemirror-view'
import { closeHistory, redo, undo } from 'prosemirror-history'
import type { TryItReading } from '@/api'
import { tryItReadingQuery } from '@/api/queries'
import {
  CalendarIcon,
  HeedDomainIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  XIcon,
} from '@/components/icons'
import { mentionText } from '@/components/item/mention-chip'
import { kindGlyphs } from '@/components/item/item-marks'
import { LIST_ROWS } from '@/components/mentions/mention-list'
import {
  ENTITY_TYPES,
  MentionPickerPopup,
  useMentionPicker,
  type MentionPicker,
} from '@/components/mentions/mention-picker'
import { syncSelection } from '@/components/mentions/mention-view'
import { findTrigger, type Trigger } from '@/components/mentions/summary-doc'
import {
  ScopeTermLabel,
  scopeTermKind,
  scopeTermSpoken,
  scopeTermWords,
  type ScopeTermView,
} from '@/components/mentions/scope-term'
import { Kbd } from '@/components/ui/kbd'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { datesOf, draftReading, draftText, type AskDraft } from '@/lib/ask-draft'
import { mentionTypeWords, targetType } from '@/lib/mention-names'
import { targetsByKey, type MentionOption } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { cn } from '@/lib/utils'
import {
  acceptOffer,
  chipToText,
  clipboardHtml,
  createAskState,
  datesChipOf,
  docDraft,
  draftFromHtml,
  insertChip,
  mapOffers,
  offersOf,
  pasteTransaction,
  removeChip,
  selectionDraft,
  setDates,
  askSchema,
  type Offer,
} from './ask-doc'
import { AskDatesPopover, daysWords, type Days } from './ask-dates'
import { choiceClass, READ_DEBOUNCE_MS } from './ask-reads'
import '@/components/item/mention-chip.css'

/*
  The Ask composer's question as a chip editor (Heed composer, stage 2; the chip input decision,
  docs/design/chip-input.md): one ProseMirror paragraph of words and chips, loaded as its own
  chunk. ProseMirror owns the words, the selection and the undo history; React owns the chips
  (rendered into each atom with a portal), the @ list, the offer under the words and the dates
  panel. `@` opens the picker item text shares (mentions/mention-picker.tsx) at the caret, with
  metrics, values, dimensions, accepted items and domains, and dates as its last row; `#` lists
  values only. People are never offered here. A chip is the question's scope: its terms bind the
  answer's tool calls, and its items and domains go with it for the assistant to read. Words Heed
  read as a name or as dates are underlined and offered as a chip, which Tab or a click takes:
  they never become one by themselves. A chip is one unit to the keys: Backspace removes it,
  Delete turns it back into words, undo takes back exactly one chip edit. A dates chip opens the
  dates panel. The plain box in ask-composer.tsx stands in while this loads, and for good if
  it cannot.
*/

export type AskEditorHandle = {
  focus: () => void
  /** Opens the @ list at the caret, as typing @ does. */
  openMention: () => void
  /** Opens the dates panel: on the question's dates chip, or for a new one at the caret. */
  openDates: () => void
  /** Makes the words a reading named more than one term for a chip of `key`. False when they are gone. */
  choose: (words: string, key: string) => boolean
}

export type AskEditorProps = {
  handle: Ref<AskEditorHandle>
  draft: AskDraft
  onDraftChange: (draft: AskDraft) => void
  /** How the service read `read`, the words the chips leave, or null while it is not read. */
  reading: TryItReading | null
  read: string
  /** Enter: send the question. */
  onSubmit: () => void
  /** Up in an empty box: the last question, or null. */
  onRecall: () => AskDraft | null
  /** The service's day, for the dates panel; null until the library has loaded. */
  today: string | null
  id: string
  label: string
  /** What describes the box, the "Heed reads" line first: the offer of a chip goes after it. */
  describedBy?: readonly string[]
  placeholder?: string
  disabled?: boolean
}

/** The atoms on screen, with where each is, so React can render a chip into each one. */
type Slot = { id: number; dom: HTMLElement; target: string; label: string; pos: () => number }
class Slots {
  private slots = new Map<number, Slot>()
  private listeners = new Set<() => void>()
  private snapshot: Slot[] = []
  private next = 0
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  getSnapshot = () => this.snapshot
  private changed() {
    this.snapshot = [...this.slots.values()]
    for (const listener of this.listeners) listener()
  }
  set(slot: Slot) {
    this.slots.set(slot.id, slot)
    this.changed()
  }
  remove(id: number) {
    this.slots.delete(id)
    this.changed()
  }
  id = () => this.next++
}

class ChipView implements NodeView {
  dom: HTMLElement
  private id: number
  private node: ProseNode
  private slots: Slots
  private getPos: () => number | undefined
  constructor(node: ProseNode, slots: Slots, getPos: () => number | undefined) {
    this.node = node
    this.slots = slots
    this.getPos = getPos
    this.dom = document.createElement('span')
    this.dom.contentEditable = 'false'
    this.dom.dataset.chip = String(node.attrs.target)
    this.id = slots.id()
    this.publish()
  }
  private publish() {
    this.slots.set({
      id: this.id,
      dom: this.dom,
      target: String(this.node.attrs.target),
      label: String(this.node.attrs.label),
      pos: () => this.getPos() ?? -1,
    })
  }
  update(node: ProseNode) {
    if (node.type !== this.node.type) return false
    const changed =
      node.attrs.target !== this.node.attrs.target || node.attrs.label !== this.node.attrs.label
    this.node = node
    this.dom.dataset.chip = String(node.attrs.target)
    if (changed) this.publish()
    return true
  }
  selectNode() {
    this.dom.dataset.selected = 'true'
  }
  deselectNode() {
    delete this.dom.dataset.selected
  }
  // React renders the chip inside; those changes are not edits.
  ignoreMutation() {
    return true
  }
  // The remove button inside handles its own clicks.
  stopEvent(event: Event) {
    return event.target instanceof Element && event.target.closest('button') !== null
  }
  destroy() {
    this.slots.remove(this.id)
  }
}

const glyphs = { metric: SigmaIcon, dim: SplitIcon, val: TagIcon } as const
const kindWord = (target: string) => {
  if (datesOf(target)) return 'dates'
  const type = targetType(target)
  return type ? mentionTypeWords[type] : 'term'
}

/**
 * A chip in the question: the words it stands for, with the look of what it is (contract 6.13,
 * "The @ mention chip"), and a remove button. A metric, a dimension and a value are quiet chips
 * with their glyph, an item carries its kind glyph and a title cut at 34 characters, and a
 * domain keeps its hue and the domain mark. A dates chip shows the days it reads after its words
 * when they say something else. A screen reader hears what it is first and how to take it off:
 * "metric Net revenue, remove".
 */
function AskChip({
  target,
  label,
  name,
  option,
  onRemove,
}: {
  target: string
  label: string
  /** The term's own name, when the words are another name for it. */
  name: string | null
  /** What the chip points at, for an item's kind and a domain's hue. */
  option: MentionOption | undefined
  onRemove: () => void
}) {
  const dates = datesOf(target)
  const type = dates ? null : targetType(target)
  const area = type === 'area'
  const kind = type === 'item' ? (option?.kind ?? 'note') : null
  const Glyph = dates
    ? CalendarIcon
    : kind
      ? kindGlyphs[kind]
      : type === 'metric' || type === 'dim' || type === 'val'
        ? glyphs[type]
        : TagIcon
  const days = dates ? daysWords(dates) : null
  const what = kindWord(target)
  const named = name && name.toLocaleLowerCase('en') !== label.toLocaleLowerCase('en') ? name : null
  return (
    <span
      // The mention chip's slot, so the field's ring for a selected chip is the summary's own.
      data-slot="mention-chip"
      data-chip="ask"
      data-kind={dates ? 'dates' : (type ?? 'term')}
      data-tone={area ? (option?.label ?? 'gray') : undefined}
      title={
        dates
          ? `Dates: ${days}`
          : `${what.charAt(0).toUpperCase()}${what.slice(1)}: ${name ?? label}`
      }
      className={cn(
        'mention-chip rounded-badge border',
        area
          ? 'border-tone-line bg-tone-tint text-tone-ink'
          : 'border-border bg-background text-foreground',
        dates && 'cursor-pointer hover:bg-muted',
      )}
    >
      {/* Hidden but in the flow, so the box's value reads "metric Net revenue, remove". */}
      <span className="sr-inline select-none">{`${what}\u00a0`}</span>
      {area ? (
        <HeedDomainIcon aria-hidden="true" className="text-tone-dot" />
      ) : (
        <Glyph
          aria-hidden="true"
          data-kind={kind ?? undefined}
          className={kind === 'issue' ? 'text-status-warning-icon' : 'text-muted-foreground'}
        />
      )}
      {type === 'item' ? mentionText('item', label) : label}
      {named ? <span className="sr-inline select-none">{`\u00a0(${named})`}</span> : null}
      {days && days !== label ? (
        <span data-slot="ask-chip-days" className="text-muted-foreground">{`\u00a0· ${days}`}</span>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Remove ${what} ${name ?? label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        className={cn(
          'cursor-pointer rounded-sm pl-1 hover:bg-muted hover:text-foreground',
          area ? 'text-tone-ink' : 'text-muted-foreground',
        )}
      >
        <XIcon aria-hidden="true" />
        <span className="sr-inline select-none">, remove</span>
      </button>
    </span>
  )
}

/** Words offered as a chip are underlined, dotted. */
const offerDecorations = (offers: readonly Offer[]) =>
  offers.map((offer) =>
    Decoration.inline(offer.from, offer.to, {
      class: 'underline decoration-dotted decoration-muted-foreground underline-offset-4',
      'data-offer': '',
    }),
  )

/** Focuses the question: a caret the editor never had goes after the words, where typing goes on. */
function focusQuestion(view: EditorView) {
  if (!view.hasFocus() && view.state.selection.from === 1)
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
  view.focus()
}

export default function AskEditor({
  handle,
  draft,
  onDraftChange,
  reading,
  read,
  onSubmit,
  onRecall,
  today,
  id,
  label,
  describedBy,
  placeholder,
  disabled,
}: AskEditorProps) {
  const listId = `${id}-list`
  const offerId = `${id}-offer`
  const mountRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // The question, which a new dates chip's panel opens beside.
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Whether the view had the focus when it was taken down.
  const hadFocus = useRef(false)
  const [slots] = useState(() => new Slots())
  const chips = useSyncExternalStore(slots.subscribe, slots.getSnapshot, slots.getSnapshot)
  const [editorState, setEditorState] = useState<EditorState>(() => createAskState(draft))
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [declined, setDeclined] = useState<ReadonlySet<string>>(() => new Set())
  const [dates, setDatesOpen] = useState<{ pos: number | null } | null>(null)
  const lastDraft = useRef(JSON.stringify(draft))
  const callbacks = useRef({ onDraftChange, onSubmit, onRecall })
  const disabledRef = useRef(disabled)
  useEffect(() => {
    callbacks.current = { onDraftChange, onSubmit, onRecall }
  }, [onDraftChange, onSubmit, onRecall])

  // Everything the question can name: the vocabulary's terms, accepted items and domains.
  const { targets, pending } = useMentionTargets()
  const lookup = targetsByKey(targets)
  // How a term reads: the reading's names, which come with the words, then the vocabulary's.
  const viewOf = useCallback(
    (key: string): ScopeTermView => {
      const named = [
        ...(reading?.about ?? []),
        ...(reading?.ambiguous ?? []).flatMap((words) => words.options),
      ].find((term) => term.key === key)
      if (named)
        return {
          kind: named.kind === 'metric_group' ? 'metric' : named.kind,
          name: named.name,
          dimensionName: named.dimension,
        }
      const option = lookup.get(key)
      const kind = scopeTermKind(key)
      return {
        kind,
        name: option?.name ?? key.slice(key.lastIndexOf('/') + 1 || key.indexOf(':') + 1),
        dimensionName: kind === 'dimension_value' ? (option?.detail ?? null) : null,
      }
    },
    [reading, lookup],
  )

  const dispatch = useCallback((tr: Transaction) => {
    const view = viewRef.current
    if (!view) return
    const next = view.state.apply(tr)
    view.updateState(next)
    setEditorState(next)
    if (tr.docChanged) {
      setOffers((now) => mapOffers(next.doc, now, tr.mapping))
      const parts = docDraft(next.doc)
      const json = JSON.stringify(parts)
      if (json !== lastDraft.current) {
        lastDraft.current = json
        callbacks.current.onDraftChange(parts)
      }
    }
  }, [])

  const rawTrigger = focused ? findTrigger(editorState) : null
  // The words after @ may name dates ("@last quarter"): the service reads them as it reads the
  // question, and the last row puts them in as a chip.
  const datesWords = rawTrigger?.char === '@' ? rawTrigger.query.trim() : ''
  const settledWords = useDebouncedValue(datesWords, READ_DEBOUNCE_MS)
  const datesReading = useQuery({
    ...tryItReadingQuery(settledWords),
    enabled: /[\p{L}\p{N}]/u.test(settledWords),
    retry: false,
  }).data
  const typedDays: Days | null =
    datesWords && settledWords === datesWords && datesReading?.from
      ? { from: datesReading.from, to: datesReading.to ?? datesReading.from }
      : null
  // The list's own state; the keys read it through a ref, so the view is made once.
  const pickerRef = useRef<MentionPicker<Trigger & { at: number }> | null>(null)
  const picker = useMentionPicker({
    listId,
    targets,
    trigger: rawTrigger && { ...rawTrigger, at: rawTrigger.from },
    types: ENTITY_TYPES,
    // The last row is the dates'.
    limit: LIST_ROWS - 1,
    row: ({ trigger: at }) =>
      at.char === '@'
        ? {
            label: typedDays ? `Dates: ${daysWords(typedDays)}` : 'Pick dates…',
            onChoose: () => pickDates(),
            icon: CalendarIcon,
            preferred: typedDays !== null,
          }
        : null,
    onPick: (option, at) => {
      const view = viewRef.current
      if (!view) return
      dispatch(insertChip(view.state, at, option.key, option.name))
      view.focus()
    },
  })
  const { trigger, open } = picker

  // The offers still standing: words Heed read, not declined, not in a chip.
  const shownOffers = useMemo(
    () => offers.filter((offer) => !declined.has(offer.words.toLocaleLowerCase('en'))),
    [offers, declined],
  )
  const offer = open || dates ? undefined : shownOffers[0]
  // Tab takes an offer of one thing: a term, or dates. Words that name several ask which.
  const tabbable = offer && (offer.dates !== null || offer.keys.length === 1) ? offer : undefined

  // A fresh reading of exactly these words replaces the offers.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !reading) return
    if (draftReading(docDraft(view.state.doc)) !== read) return
    setOffers(offersOf(view.state.doc, reading, read))
  }, [reading, read])

  // Keyboard handling reads the latest list and offer through a ref, so the view is made once.
  const listRef = useRef({ trigger, typedDays, tabbable })
  useEffect(() => {
    pickerRef.current = picker
    listRef.current = { trigger, typedDays, tabbable }
  })

  /** The dates row: the dates the words after @ name, else the panel for a new dates chip. */
  const pickDates = useCallback(() => {
    const view = viewRef.current
    const current = listRef.current
    if (!view || !current.trigger) return
    const days = current.typedDays
    const range = { from: current.trigger.from, to: current.trigger.to }
    if (days) {
      // The @ and its words become a dates chip that says them.
      const words = current.trigger.query.trim()
      const tr = acceptOffer(view.state, { ...range, words, keys: [], dates: days })
      if (tr) dispatch(tr)
    } else {
      dispatch(closeHistory(view.state.tr).delete(range.from, range.to))
      setDatesOpen({ pos: null })
    }
    view.focus()
  }, [dispatch])

  const accept = useCallback(
    (target: Offer, key?: string) => {
      const view = viewRef.current
      if (!view) return
      const tr = acceptOffer(view.state, target, key)
      if (tr) dispatch(tr)
      view.focus()
    },
    [dispatch],
  )

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const openDatesOn = (pos: number, node: ProseNode) => {
      if (node.type !== askSchema.nodes.chip || !datesOf(String(node.attrs.target))) return false
      // Once the click is over: the panel would read the click that opened it as one outside it.
      window.setTimeout(() => setDatesOpen({ pos }))
      return true
    }
    const view: EditorView = new EditorView(mount, {
      state: createAskState(JSON.parse(lastDraft.current) as AskDraft),
      dispatchTransaction: (tr) => dispatch(tr),
      nodeViews: {
        chip: (node, _view, getPos) => new ChipView(node, slots, getPos),
      },
      // A click on a dates chip opens its dates, and so does a second click soon after it, which
      // ProseMirror reads as a double click.
      handleClickOn: (_view, pos, node) => openDatesOn(pos, node),
      handleDoubleClickOn: (_view, pos, node) => openDatesOn(pos, node),
      handleKeyDown: (view, event) => {
        // A word being composed (an IME, a phone keyboard) is the input method's until it ends.
        if (event.isComposing || event.keyCode === 229) return false
        syncSelection(view)
        const list = listRef.current
        const key = pickerRef.current?.keyDown(event.key) ?? null
        if (key === 'handled') {
          // The list's Escape only closes the list: the assistant's panel closes on one too.
          if (event.key === 'Escape') event.stopPropagation()
          return true
        }
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
        // Left or Right on a selection collapses it to that end in the editor's own state at once, so
        // the words typed next go there and never replace what was selected.
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !selection.empty &&
          !(selection instanceof NodeSelection) &&
          !event.shiftKey &&
          !mod &&
          !event.altKey
        ) {
          const left = event.key === 'ArrowLeft'
          const at = view.state.doc.resolve(left ? selection.from : selection.to)
          view.dispatch(view.state.tr.setSelection(TextSelection.near(at, left ? 1 : -1)))
          return true
        }
        if (event.key === 'Enter') {
          if (event.shiftKey) {
            view.dispatch(
              view.state.tr
                .replaceSelectionWith(askSchema.nodes.hard_break.create())
                .scrollIntoView(),
            )
            return true
          }
          if (!mod && !event.altKey) callbacks.current.onSubmit()
          return true
        }
        // Tab takes the offered chip; with nothing offered it moves on, as Tab does.
        if (event.key === 'Tab' && !event.shiftKey && !mod && !event.altKey && list.tabbable) {
          const tr = acceptOffer(view.state, list.tabbable, list.tabbable.keys[0])
          if (tr) view.dispatch(tr)
          return true
        }
        if (event.key === 'ArrowUp' && view.state.doc.content.size <= 2) {
          const last = callbacks.current.onRecall()
          if (last) {
            const next = createAskState(last)
            view.updateState(next)
            setEditorState(next)
            const json = JSON.stringify(last)
            lastDraft.current = json
            callbacks.current.onDraftChange(last)
            view.dispatch(
              view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).scrollIntoView(),
            )
            return true
          }
        }
        // A selected chip: Delete turns it back into its words, Backspace removes it whole.
        if (selection instanceof NodeSelection && event.key === 'Delete') {
          const tr = chipToText(view.state, selection.from)
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
            node?.type === askSchema.nodes.chip
              ? removeChip(view.state, event.key === 'Backspace' ? $pos.pos - 1 : $pos.pos)
              : null
          if (tr) {
            view.dispatch(tr)
            return true
          }
        }
        // Space on a selected dates chip opens its panel (Enter sends the question).
        if (
          selection instanceof NodeSelection &&
          event.key === ' ' &&
          datesOf(String(selection.node.attrs.target))
        ) {
          setDatesOpen({ pos: selection.from })
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const text = data.getData('text/plain')
        const parts = draftFromHtml(data.getData('text/html'))
        view.dispatch(pasteTransaction(view.state, { text, draft: parts }))
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
    // A view made again (React mounts it twice in development) keeps the focus the last one had,
    // so the words typed next still go into the question.
    if (hadFocus.current) focusQuestion(view)
    return () => {
      hadFocus.current = view.hasFocus()
      view.destroy()
      viewRef.current = null
    }
  }, [dispatch, slots])

  // A draft set from outside (sent, New chat, the plain box) replaces the words; history starts over.
  useEffect(() => {
    const view = viewRef.current
    const json = JSON.stringify(draft)
    if (!view || json === lastDraft.current) return
    lastDraft.current = json
    const next = createAskState(draft)
    view.updateState(next)
    setEditorState(next)
    setOffers([])
  }, [draft])

  useEffect(() => {
    disabledRef.current = disabled
    viewRef.current?.setProps({})
  }, [disabled])

  const described = [...(describedBy ?? [])]
  if (tabbable) described.splice(1, 0, offerId)
  // The view's own attributes: a text box that suggests from a list.
  useEffect(() => {
    viewRef.current?.setProps({
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        'aria-controls': listId,
        'aria-keyshortcuts': 'Enter',
        ...(picker.activeDescendant ? { 'aria-activedescendant': picker.activeDescendant } : {}),
        // What Heed reads first, then what Tab would make a chip, then the rest. Words that name
        // more than one term are said by the line already.
        ...(described.length ? { 'aria-describedby': described.join(' ') } : {}),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        ...(placeholder ? { 'aria-placeholder': placeholder } : {}),
        spellcheck: 'true',
        'data-slot': 'ask-editor',
        'data-question': '',
        class:
          'max-h-chart min-h-control-lg w-full overflow-y-auto px-2 py-1 text-body break-words whitespace-break-spaces outline-none [font-variant-ligatures:none] pointer-coarse:text-large',
      },
      decorations: (state) => DecorationSet.create(state.doc, offerDecorations(shownOffers)),
    })
  })

  // Where the list opens: above the @, inside the composer's width, since the composer sits at
  // the bottom of the panel and of the page.
  useLayoutEffect(() => {
    const view = viewRef.current
    const wrapper = wrapperRef.current
    if (!open || !view || !wrapper || !trigger) {
      setPosition(null)
      return
    }
    const coords = view.coordsAtPos(trigger.from)
    const box = wrapper.getBoundingClientRect()
    setPosition({ left: coords.left - box.left, bottom: box.bottom - coords.top })
  }, [open, trigger?.from, editorState]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    handle,
    () => ({
      focus: () => {
        if (viewRef.current) focusQuestion(viewRef.current)
      },
      openMention: () => {
        const view = viewRef.current
        if (!view) return
        const { $from, from, to } = view.state.selection
        const before = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 1),
          $from.parentOffset,
          '\n',
          '￼',
        )
        // An @ at the start of a word opens the list: after a space, or one is put first.
        const at = !before || /\s/.test(before) ? '@' : ' @'
        view.dispatch(view.state.tr.insertText(at, from, to).scrollIntoView())
        pickerRef.current?.reset()
        view.focus()
      },
      openDates: () => {
        const view = viewRef.current
        if (!view) return
        setDatesOpen({ pos: datesChipOf(view.state.doc)?.pos ?? null })
      },
      choose: (words, key) => {
        const view = viewRef.current
        const said = words.toLocaleLowerCase('en')
        const target = offers.find(
          (one) => one.words.toLocaleLowerCase('en') === said && one.keys.includes(key),
        )
        if (!view || !target) return false
        accept(target, key)
        return true
      },
    }),
    [offers, accept],
  )

  const empty = editorState.doc.content.size <= 2
  const datesChip = dates?.pos !== null && dates ? editorState.doc.nodeAt(dates.pos) : null
  const datesDays = datesChip ? datesOf(String(datesChip.attrs.target)) : null
  const datesAnchor =
    dates && dates.pos !== null
      ? (chips.find((slot) => slot.pos() === dates.pos)?.dom ?? wrapper)
      : wrapper

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node
        setWrapper(node)
      }}
      className="relative w-full min-w-0"
    >
      <div
        data-slot="ask-editor-field"
        data-disabled={disabled || undefined}
        className="relative w-full cursor-text data-disabled:cursor-not-allowed [&_[data-selected]]:selection:bg-transparent [&_[data-selected]>[data-slot=mention-chip]]:ring-2 [&_[data-selected]>[data-slot=mention-chip]]:ring-ring"
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
            className="pointer-events-none absolute inset-x-0 top-0 truncate px-2 py-1 text-body text-muted-foreground pointer-coarse:text-large"
          >
            {placeholder}
          </span>
        ) : null}
        <div ref={mountRef} />
      </div>
      {chips.map((chip) =>
        createPortal(
          <AskChip
            target={chip.target}
            label={chip.label}
            name={datesOf(chip.target) ? null : viewOf(chip.target).name}
            option={lookup.get(chip.target)}
            onRemove={() => {
              const view = viewRef.current
              if (!view) return
              const tr = removeChip(view.state, chip.pos())
              if (tr) dispatch(tr)
              view.focus()
            }}
          />,
          chip.dom,
          String(chip.id),
        ),
      )}
      <MentionPickerPopup
        picker={picker}
        point={position}
        side="top"
        label={
          trigger?.char === '#'
            ? 'Mention a value'
            : 'Mention a metric, value, dimension, fact or domain'
        }
        closedLabel="Mentions"
        empty={pending ? 'Loading what can be mentioned…' : 'No match.'}
        peek={false}
      />
      {offer ? (
        <OfferLine
          id={offerId}
          offer={offer}
          viewOf={viewOf}
          tabbable={tabbable === offer}
          onAccept={(key) => accept(offer, key)}
          onDecline={() => {
            setDeclined((words) => new Set([...words, offer.words.toLocaleLowerCase('en')]))
            viewRef.current?.focus()
          }}
        />
      ) : null}
      <AskDatesPopover
        open={dates !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDatesOpen(null)
            viewRef.current?.focus()
          }
        }}
        anchor={datesAnchor}
        today={today}
        days={datesDays}
        onUse={(days, words) => {
          const view = viewRef.current
          if (!view) return
          dispatch(setDates(view.state, days, words, dates?.pos ?? null))
        }}
        onRemove={
          dates?.pos !== null && dates && datesDays
            ? () => {
                const view = viewRef.current
                const tr = view && dates.pos !== null ? removeChip(view.state, dates.pos) : null
                if (tr) dispatch(tr)
              }
            : undefined
        }
      />
    </div>
  )
}

/**
 * Under the words, what Heed read in them that could be a chip: "Make “net revenue” a chip?" with
 * the chip it would make, which Tab or a click takes, or one button for each term ambiguous words
 * could be. Dismiss leaves the words as they are; Heed still reads them, as the line says.
 */
function OfferLine({
  id,
  offer,
  viewOf,
  tabbable,
  onAccept,
  onDecline,
}: {
  id: string
  offer: Offer
  viewOf: (key: string) => ScopeTermView
  tabbable: boolean
  onAccept: (key?: string) => void
  onDecline: () => void
}) {
  const several = offer.keys.length > 1
  return (
    <div
      data-slot="ask-offer"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-caption text-muted-foreground"
    >
      <span id={id} className="min-w-0">
        {several ? (
          <>
            <b className="font-bold text-foreground">“{offer.words}”</b> could be{' '}
            {offer.keys.map((key) => scopeTermWords(viewOf(key))).join(' or ')}. Which one?
          </>
        ) : (
          <>
            Make <b className="font-bold text-foreground">“{offer.words}”</b> a chip?
            {tabbable ? <span className="sr-only"> Press Tab.</span> : null}
          </>
        )}
      </span>
      {offer.dates ? (
        <button
          type="button"
          aria-label={`Make “${offer.words}” the dates ${daysWords(offer.dates)}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAccept()}
          className={choiceClass}
        >
          <CalendarIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate">{daysWords(offer.dates)}</span>
        </button>
      ) : (
        offer.keys.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`Make “${offer.words}” ${scopeTermSpoken(viewOf(key))}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAccept(key)}
            className={choiceClass}
          >
            <ScopeTermLabel term={viewOf(key)} />
          </button>
        ))
      )}
      {tabbable ? (
        <Kbd aria-hidden="true" className="pointer-coarse:hidden">
          Tab
        </Kbd>
      ) : null}
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDecline}
        className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-control-touch"
      >
        Leave as words
      </button>
    </div>
  )
}

/** Copy writes the words as plain text, and the chips in the HTML, so a paste here keeps them. */
function copyOrCut(view: EditorView, event: ClipboardEvent, cut: boolean) {
  const data = event.clipboardData
  if (!data || view.state.selection.empty) return false
  const parts = selectionDraft(view.state)
  data.clearData()
  const text = draftText(parts)
  data.setData('text/plain', text)
  data.setData('text/html', clipboardHtml(text, parts))
  event.preventDefault()
  if (cut)
    view.dispatch(
      closeHistory(view.state.tr).deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'),
    )
  return true
}
