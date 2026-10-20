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
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { DecorationSet, EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { closeHistory } from 'prosemirror-history'
import type { ItemKind } from '@domain/item'
import { MentionChip } from '@/components/item/mention-chip'
import { PreviewTrigger } from '@/components/preview/preview-trigger'
import { chipTargetOf } from '@/components/mentions/mention-text'
import { ListAnchor, optionId } from '@/components/mentions/mention-list'
import {
  ENTITY_TYPES,
  MentionPickerList,
  pickerStatus,
  useMentionPicker,
  type MentionPicker,
} from '@/components/mentions/mention-picker'
import { ChipSlots, MentionView, syncSelection } from '@/components/mentions/mention-view'
import {
  findTrigger,
  markupFromHtml,
  MARKUP_MIME,
  MENTIONS_MAX,
} from '@/components/mentions/summary-doc'
import type { MentionStatus } from '@/lib/mention-names'
import { triggerBefore } from '@/lib/mention-markup'
import { targetsByKey, type MentionOption } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'
import {
  blockOf,
  createBodyState,
  findSlash,
  inCode,
  insertBodyMention,
  markActive,
  matchSlash,
  pasteMarkdown,
  runSlash,
  selectedLink,
  setLink,
  slashItems,
  toggleHeading,
  type SlashItem,
  type SlashTrigger,
} from './body-commands'
import { bodyMentionCount, bodySchema, docToMarkdown, markdownToDoc } from './body-doc'
import { FormatToolbar, type FormatAction } from './format-toolbar'
import { SlashMenu } from './slash-menu'
import { TextCheckNote } from './text-check-note'
import { textCheckDecorations, textCheckMatches } from './text-check'
import './body-editor.css'

/*
  The body of the page editor (contract 9.6, FR-119): the item text as a document that renders
  the safe Markdown subset while it is typed. ProseMirror owns the text, the selection and the
  undo history; React owns the chips (one MentionChip per atom, through a portal), the @ list, the
  / menu and the selection toolbar. The stored form is the Markdown of body-doc.ts, written only
  when the person changes something, so a body nobody touched is never rewritten.
*/

export type BodyEditorProps = {
  /** The body as Markdown in the subset, mentions as `@[words](target)`. */
  value: string
  onChange: (markdown: string) => void
  /** The item's kind: a guide's / menu offers its steps template. Text that is not an item's leaves it out. */
  kind?: ItemKind
  /**
   * Whether `@` and `#` open the mention list. Off, the field keeps its blocks and formatting but
   * offers no mention: the / menu and the toolbar leave theirs out (mentions are for item text).
   */
  mentions?: boolean
  /**
   * `zone` sits borderless in the page editor, whose page handles Mod Enter; `field` is a bordered
   * box in a form, and Mod Enter submits that form.
   */
  appearance?: 'zone' | 'field'
  /** The text size: `large` as the item page reads, `reading` as a record's prose reads. */
  size?: 'large' | 'reading'
  id?: string
  label?: string
  labelledBy?: string
  describedBy?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  /** The state of targets the text already mentions, when it is known. */
  statuses?: Readonly<Record<string, MentionStatus>>
  /** Asks an owner to add a term the @ list does not have. */
  onRequestTerm?: (words: string) => void
  /** Up or Backspace at the very start goes back to the field before (the summary). */
  onLeave?: (where: 'previous') => void
  /** Marks words the text check of FR-117 would refuse, with a sentence and "Remove it". */
  checkText?: boolean
}

type Point = { left: number; top: number }

export default function BodyEditor({
  value,
  onChange,
  kind,
  mentions = true,
  appearance = 'zone',
  size = 'large',
  targets,
  pending,
  listId,
  id,
  label,
  labelledBy,
  describedBy,
  placeholder,
  disabled,
  invalid,
  statuses,
  onRequestTerm,
  onLeave,
  checkText = false,
}: BodyEditorProps & { targets: MentionOption[]; pending: boolean; listId: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [slots] = useState(() => new ChipSlots())
  const chips = useSyncExternalStore(slots.subscribe, slots.getSnapshot, slots.getSnapshot)
  const [editorState, setEditorState] = useState<EditorState>(() => createBodyState(value))
  const [focused, setFocused] = useState(false)
  const [inToolbar, setInToolbar] = useState(false)
  const [slashActive, setSlashActive] = useState<string | null>(null)
  const [slashDismissed, setSlashDismissed] = useState<number | null>(null)
  const [points, setPoints] = useState<{ list: Point | null; toolbar: Point | null }>({
    list: null,
    toolbar: null,
  })
  const lastMarkdown = useRef(value)
  const disabledRef = useRef(disabled)
  const fieldRef = useRef(appearance === 'field')
  const callbacks = useRef({ onChange, onLeave, onRequestTerm })
  useEffect(() => {
    callbacks.current = { onChange, onLeave, onRequestTerm }
  }, [onChange, onLeave, onRequestTerm])

  const lookup = targetsByKey(targets)
  const state = editorState

  // ---- the @ list
  const rawTrigger = mentions && focused && !inCode(state) ? findTrigger(state) : null
  const full = bodyMentionCount(state.doc) >= MENTIONS_MAX
  const picker: MentionPicker<NonNullable<typeof rawTrigger> & { at: number }> = useMentionPicker({
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
                callbacks.current.onRequestTerm?.(words)
                menus.current.picker.dismiss()
                viewRef.current?.focus()
              },
            }
          }
        : undefined,
    onPick: (option, at) => {
      const view = viewRef.current
      if (!view) return
      dispatch(insertBodyMention(view.state, at, option))
      view.focus()
    },
  })
  const { trigger } = picker
  const mentionOpen = picker.open

  // ---- the / menu
  const items = useMemo(
    () => slashItems(kind ?? '').filter((item) => mentions || item.id !== 'mention'),
    [kind, mentions],
  )
  const rawSlash = focused && !trigger ? findSlash(state) : null
  const slash = rawSlash && rawSlash.from !== slashDismissed ? rawSlash : null
  const slashMatches = slash ? matchSlash(items, slash.query, state) : []
  const slashOpen = slash !== null && slashMatches.length > 0
  const slashKey =
    slashActive && slashMatches.some((item) => item.id === slashActive)
      ? slashActive
      : (slashMatches[0]?.id ?? null)
  const menuId = `${listId}-blocks`

  // ---- the selection toolbar
  const { selection } = state
  const toolbarShown =
    (focused || inToolbar) &&
    !disabled &&
    selection instanceof TextSelection &&
    !selection.empty &&
    !selection.$from.parent.type.spec.code &&
    !mentionOpen &&
    !slashOpen
  const words = toolbarShown ? state.doc.textBetween(selection.from, selection.to, ' ', ' ') : ''
  const mentionable =
    mentions &&
    selection.$from.sameParent(selection.$to) &&
    triggerBefore(`@${words.trim()}`) !== null

  // ---- the text check
  const checks = useMemo(
    () => (checkText ? textCheckMatches(state.doc) : []),
    [checkText, state.doc],
  )
  const check = checks[0]
  const checkId = `${listId}-check`

  // Keys read the latest menus through a ref, so the view is created once.
  const menus = useRef({
    mentionOpen,
    picker,
    slashOpen,
    slash,
    slashMatches,
    slashKey,
    toolbarShown,
  })
  useEffect(() => {
    menus.current = {
      mentionOpen,
      picker,
      slashOpen,
      slash,
      slashMatches,
      slashKey,
      toolbarShown,
    }
  })

  const dispatch = useCallback((tr: Transaction) => {
    const view = viewRef.current
    if (!view) return
    const next = view.state.apply(tr)
    view.updateState(next)
    setEditorState(next)
    if (tr.docChanged && !tr.getMeta('external')) {
      const markdown = docToMarkdown(next.doc)
      if (markdown !== lastMarkdown.current) {
        lastMarkdown.current = markdown
        callbacks.current.onChange(markdown)
      }
    }
  }, [])

  const runItem = useCallback(
    (item: SlashItem, at: SlashTrigger | null) => {
      const view = viewRef.current
      if (!view || !at) return
      const tr = runSlash(view.state, at, item)
      if (tr) dispatch(tr)
      setSlashActive(null)
      view.focus()
    },
    [dispatch],
  )

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const view: EditorView = new EditorView(mount, {
      state: createBodyState(lastMarkdown.current),
      dispatchTransaction: (tr) => dispatch(tr),
      nodeViews: { mention: (node) => new MentionView(node, slots) },
      handleKeyDown: (view, event) => {
        syncSelection(view)
        const current = menus.current
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey
        if (current.mentionOpen && plain) {
          const key = current.picker.keyDown(event.key)
          if (key === 'handled') {
            // Only the menu closes: a dialog around the field stays open.
            if (event.key === 'Escape') event.stopPropagation()
            return true
          }
          if (key === 'empty') return event.key === 'Enter'
        }
        if (current.slashOpen && plain) {
          const list = current.slashMatches
          const at = list.findIndex((item) => item.id === current.slashKey)
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const step = event.key === 'ArrowDown' ? 1 : -1
            setSlashActive(list[(at + step + list.length) % list.length]?.id ?? null)
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = list[at] ?? list[0]
            if (item) runItem(item, current.slash)
            return true
          }
          if (event.key === 'Escape') {
            setSlashDismissed(current.slash?.from ?? null)
            event.stopPropagation()
            return true
          }
        }
        if (current.toolbarShown && event.altKey && event.key === 'F10') {
          toolbarRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
          return true
        }
        if (current.toolbarShown && event.key === 'Escape') {
          const head = view.state.selection.head
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, head)))
          event.stopPropagation()
          return true
        }
        if (fieldRef.current && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          view.dom.closest('form')?.requestSubmit()
          event.stopPropagation()
          return true
        }
        const leave = callbacks.current.onLeave
        const { selection } = view.state
        if (leave && plain && !event.shiftKey && selection.empty) {
          const $from = selection.$from
          const first = $from.depth === 1 && $from.index(0) === 0
          if (event.key === 'ArrowUp' && first && view.endOfTextblock('up')) {
            leave('previous')
            return true
          }
          if (
            event.key === 'Backspace' &&
            first &&
            $from.parentOffset === 0 &&
            $from.parent.type === bodySchema.nodes.paragraph
          ) {
            leave('previous')
            return true
          }
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const html = data.getData('text/html')
        // A copy from this editor keeps its blocks and chips: ProseMirror reads its own HTML.
        if (html.includes('data-pm-slice')) return false
        const text = data.getData(MARKUP_MIME) || markupFromHtml(html) || data.getData('text/plain')
        if (!text) return true
        view.dispatch(pasteMarkdown(view.state, text))
        return true
      },
      // Moving text inside the editor by drag is fine; nothing is dropped in from outside.
      handleDrop: (_view, _event, _slice, moved) => !moved,
      handleDOMEvents: {
        focus: () => {
          setFocused(true)
          return false
        },
        blur: () => {
          setFocused(false)
          setSlashDismissed(null)
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
  }, [dispatch, runItem, slots])

  // A body set from outside (the rest of a long summary paste, a reset) replaces the text as one
  // undo step, and is not written back: only the person's own edits are.
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === lastMarkdown.current) return
    lastMarkdown.current = value
    const doc = markdownToDoc(value)
    dispatch(
      closeHistory(view.state.tr)
        .replaceWith(0, view.state.doc.content.size, doc.content)
        .setMeta('external', true),
    )
  }, [value, dispatch])

  useEffect(() => {
    disabledRef.current = disabled
    viewRef.current?.setProps({})
  }, [disabled])

  const popup = mentionOpen ? listId : slashOpen ? menuId : undefined
  const activeOption = mentionOpen
    ? picker.activeDescendant
    : slashOpen && slashKey
      ? optionId(menuId, slashKey)
      : undefined
  useEffect(() => {
    viewRef.current?.setProps({
      attributes: {
        ...(id ? { id } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        ...(popup ? { 'aria-controls': popup } : {}),
        ...(activeOption ? { 'aria-activedescendant': activeOption } : {}),
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
        ...(label ? { 'aria-label': label } : {}),
        ...(describedBy || check
          ? { 'aria-describedby': [describedBy, check ? checkId : ''].filter(Boolean).join(' ') }
          : {}),
        ...(invalid || check ? { 'aria-invalid': 'true' } : {}),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        ...(placeholder ? { 'aria-placeholder': placeholder } : {}),
        'aria-keyshortcuts': 'Alt+F10',
        spellcheck: 'true',
        class: 'body-editor-text',
      },
      decorations: (current) => DecorationSet.create(current.doc, textCheckDecorations(checks)),
    })
  })

  // Where the menus open: under the @ or the /, or above the selection for the toolbar.
  useLayoutEffect(() => {
    const view = viewRef.current
    const wrapper = wrapperRef.current
    if (!view || !wrapper) return
    const box = wrapper.getBoundingClientRect()
    const at = trigger?.from ?? (slashOpen ? slash?.from : undefined)
    let list: Point | null = null
    if (at !== undefined) {
      const coords = view.coordsAtPos(at)
      list = { left: coords.left - box.left, top: coords.bottom - box.top }
    }
    let toolbar: Point | null = null
    if (toolbarShown) {
      const start = view.coordsAtPos(selection.from)
      const end = view.coordsAtPos(selection.to)
      const height = toolbarRef.current?.offsetHeight ?? 40
      const width = toolbarRef.current?.offsetWidth ?? 0
      // Above the words unless the page header would cover it, then under them.
      const above = start.top - height - 8 > 64
      toolbar = {
        left: Math.max(0, Math.min(start.left - box.left, box.width - width)),
        top: above ? start.top - box.top - height - 8 : end.bottom - box.top + 8,
      }
    }
    setPoints((previous) =>
      JSON.stringify(previous) === JSON.stringify({ list, toolbar }) ? previous : { list, toolbar },
    )
  }, [editorState, trigger?.from, slashOpen, slash?.from, toolbarShown]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: FormatAction) => {
    const view = viewRef.current
    if (!view) return
    const { marks } = bodySchema
    const command =
      action === 'bold'
        ? toggleMark(marks.strong)
        : action === 'italic'
          ? toggleMark(marks.em)
          : action === 'code'
            ? toggleMark(marks.code)
            : action === 'h2'
              ? toggleHeading(2)
              : action === 'h3'
                ? toggleHeading(3)
                : null
    if (command) command(view.state, view.dispatch, view)
    else {
      // A mention made from the selected words: they become the @ query.
      const { from, to } = view.state.selection
      view.dispatch(closeHistory(view.state.tr).insertText(`@${words.trim()}`, from, to))
      view.focus()
    }
  }

  const block = blockOf(state)
  const empty =
    state.doc.childCount === 1 &&
    state.doc.firstChild?.type === bodySchema.nodes.paragraph &&
    state.doc.firstChild.content.size === 0

  return (
    <div ref={wrapperRef} data-slot="body-editor" className="relative flex w-full flex-col gap-3">
      {/* The box's look per appearance and size is in body-editor.css, which loads with the editor. */}
      <div
        data-slot="body-editor-box"
        data-appearance={appearance}
        data-size={size}
        data-disabled={disabled || undefined}
        data-invalid={invalid || check ? true : undefined}
        className="relative w-full cursor-text data-disabled:cursor-not-allowed data-disabled:opacity-50"
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
            data-slot="body-editor-placeholder"
            className="pointer-events-none absolute inset-x-0 top-0 text-muted-foreground"
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
      {mentionOpen ? (
        <MentionPickerList
          picker={picker}
          point={points.list}
          label={
            trigger?.char === '#' ? 'Mention a value' : 'Mention a metric, value, fact or domain'
          }
          empty={
            full
              ? `At most ${MENTIONS_MAX} mentions in one field. Remove one to add another.`
              : pending
                ? 'Loading the names…'
                : undefined
          }
        />
      ) : slashOpen ? (
        <ListAnchor point={points.list}>
          <SlashMenu
            id={menuId}
            items={slashMatches}
            activeId={slashKey}
            onPick={(item) => runItem(item, slash)}
            onActivate={setSlashActive}
          />
        </ListAnchor>
      ) : null}
      {toolbarShown ? (
        <div
          className="absolute z-popover"
          style={{ left: points.toolbar?.left ?? 0, top: points.toolbar?.top ?? 0 }}
          onFocus={() => setInToolbar(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setInToolbar(false)
          }}
        >
          <FormatToolbar
            toolbarRef={toolbarRef}
            pressed={{
              bold: markActive(state, bodySchema.marks.strong),
              italic: markActive(state, bodySchema.marks.em),
              code: markActive(state, bodySchema.marks.code),
              h2: block.type === 'heading' && block.level === 2,
              h3: block.type === 'heading' && block.level === 3,
            }}
            available={{
              h2: toggleHeading(2)(state),
              h3: toggleHeading(3)(state),
              mention: mentionable,
            }}
            link={selectedLink(state)}
            onAction={act}
            onLink={(href) => {
              const view = viewRef.current
              if (!view) return
              const tr = setLink(view.state, href)
              if (tr) dispatch(tr)
              view.focus()
            }}
            onReturn={() => viewRef.current?.focus()}
          />
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {mentionOpen
          ? pickerStatus(picker)
          : slashOpen
            ? `${slashMatches.length} ${slashMatches.length === 1 ? 'block' : 'blocks'}.`
            : toolbarShown
              ? 'Formatting is available. Press Alt F10 to reach it.'
              : ''}
      </span>
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
    </div>
  )
}
