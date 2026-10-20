import { Fragment, Slice, type MarkType, type NodeType } from 'prosemirror-model'
import {
  EditorState,
  Selection,
  TextSelection,
  type Command,
  type Plugin,
  type Transaction,
} from 'prosemirror-state'
import {
  baseKeymap,
  chainCommands,
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands'
import { closeHistory, history, redo, undo } from 'prosemirror-history'
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { liftListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { mentionWords } from '@/lib/mention-markup'
import type { MentionOption } from '@/lib/mention-targets'
import { bodySchema, markdownToDoc } from './body-doc'

/*
  What the body editor does to its document: Markdown shortcuts as you type, the keys, the slash
  menu's blocks and the selection toolbar's marks. Pure (state in, transaction out), so each one
  is unit tested without a browser, and only inside the subset of body-doc.ts.
*/

const { nodes, marks } = bodySchema

// ---------------------------------------------------------------- Markdown as you type

/** `**bold**`, `*italic*`, `_italic_` and `` `code` `` become the mark when the closing sign is typed. */
function markRule(pattern: RegExp, type: MarkType) {
  return new InputRule(pattern, (state, match, start, end) => {
    const words = match[1] ?? ''
    if (!words) return null
    const at = start + (match[0].length - match[0].trimStart().length)
    const $at = state.doc.resolve(at)
    if ($at.parent.type.spec.code || marks.code.isInSet($at.marks())) return null
    const tr = state.tr.replaceWith(
      at,
      end,
      bodySchema.text(words, [type.create(), ...$at.marks()]),
    )
    return tr.removeStoredMark(type)
  })
}

export const bodyInputRules = inputRules({
  rules: [
    textblockTypeInputRule(/^##\s$/, nodes.heading, { level: 2 }),
    textblockTypeInputRule(/^###\s$/, nodes.heading, { level: 3 }),
    wrappingInputRule(/^\s*[-*]\s$/, nodes.bullet_list),
    wrappingInputRule(
      /^(\d{1,9})[.)]\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + Number(node.attrs.order) === Number(match[1]),
    ),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    textblockTypeInputRule(/^```$/, nodes.code_block),
    markRule(/(?:^|\s)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks.strong),
    markRule(/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, marks.em),
    markRule(/(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, marks.em),
    markRule(/(?:^|[^`])`([^`]+)`$/, marks.code),
  ],
})

// ---------------------------------------------------------------- blocks

/** The text block the caret is in, and the list item around it if there is one. */
function around(state: EditorState) {
  const { $from } = state.selection
  const item = $from.depth >= 2 && $from.node(-1).type === nodes.list_item ? $from.node(-2) : null
  return { block: $from.parent, list: item }
}

/**
 * Runs commands one after another as one transaction, so one undo takes back all of them. It
 * applies only when every command does.
 */
function sequence(...commands: Command[]): Command {
  return (state, dispatch, view) => {
    const tr = state.tr
    let current = state
    for (const command of commands) {
      let step: Transaction | null = null
      if (!command(current, (inner) => (step = inner), view) || !step) return false
      const inner: Transaction = step
      for (const each of inner.steps) tr.step(each)
      if (inner.selectionSet) tr.setSelection(Selection.fromJSON(tr.doc, inner.selection.toJSON()))
      if (inner.storedMarksSet) tr.setStoredMarks(inner.storedMarks)
      current = current.apply(inner)
    }
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

/** Takes the block one level out of a list or a quote. */
const liftOut: Command = (state, dispatch, view) =>
  state.selection.$from.depth > 1 &&
  chainCommands(liftListItem(nodes.list_item), lift)(state, dispatch, view)

/** Sets the block's type, taking it out of a list (or a list in a quote) first when it must. */
function setBlock(type: NodeType, attrs?: Record<string, unknown>): Command {
  return chainCommands(
    setBlockType(type, attrs),
    sequence(liftOut, setBlockType(type, attrs)),
    sequence(liftOut, liftOut, setBlockType(type, attrs)),
  )
}

/** Turns the block into a heading of this level, or back into a paragraph if it is one already. */
export function toggleHeading(level: 2 | 3): Command {
  return (state, dispatch, view) => {
    const { block } = around(state)
    if (block.type === nodes.heading && block.attrs.level === level)
      return setBlockType(nodes.paragraph)(state, dispatch, view)
    return setBlock(nodes.heading, { level })(state, dispatch, view)
  }
}

/** Puts the block in a list of this type, changes the list's type, or takes it out of the list. */
export function toggleList(type: NodeType): Command {
  return (state, dispatch, view) => {
    const { list } = around(state)
    if (list?.type === type) return liftListItem(nodes.list_item)(state, dispatch, view)
    if (list) {
      const { $from } = state.selection
      const attrs = type === nodes.ordered_list ? { order: 1 } : null
      dispatch?.(state.tr.setNodeMarkup($from.before(-2), type, attrs))
      return true
    }
    // A heading or a code block becomes a paragraph first: a list item holds one paragraph.
    return chainCommands(
      wrapInList(type),
      sequence(setBlockType(nodes.paragraph), wrapInList(type)),
    )(state, dispatch, view)
  }
}

export const toggleQuote: Command = (state, dispatch, view) => {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type === nodes.blockquote) return lift(state, dispatch, view)
  return wrapIn(nodes.blockquote)(state, dispatch, view)
}

export const toggleCodeBlock: Command = (state, dispatch, view) =>
  around(state).block.type === nodes.code_block
    ? setBlockType(nodes.paragraph)(state, dispatch, view)
    : setBlock(nodes.code_block)(state, dispatch, view)

/** A heading, a code block or a quote at the very start goes back to a paragraph on Backspace. */
const resetAtStart: Command = (state, dispatch, view) => {
  const { $cursor } = state.selection as TextSelection
  if (!$cursor || $cursor.parentOffset > 0) return false
  const block = $cursor.parent
  if (block.type === nodes.heading || block.type === nodes.code_block)
    return setBlockType(nodes.paragraph)(state, dispatch, view)
  return false
}

/** Shift Enter: a line break inside a paragraph. A heading or a list item holds one line. */
const lineBreak: Command = (state, dispatch) => {
  const { block, list } = around(state)
  if (block.type === nodes.code_block) {
    dispatch?.(state.tr.insertText('\n').scrollIntoView())
    return true
  }
  // Taken, and nothing happens: a heading or a list item holds one line.
  if (block.type !== nodes.paragraph || list) return true
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView())
  return true
}

const { 'Mod-Enter': _exitCode, ...keys } = baseKeymap

export const bodyKeymap = keymap({
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  Backspace: chainCommands(undoInputRule, resetAtStart),
  Enter: splitListItem(nodes.list_item),
  'Shift-Enter': lineBreak,
  'Mod-b': toggleMark(marks.strong),
  'Mod-i': toggleMark(marks.em),
  'Mod-e': toggleMark(marks.code),
  'Mod-Alt-2': toggleHeading(2),
  'Mod-Alt-3': toggleHeading(3),
  'Mod-Alt-0': setBlockType(nodes.paragraph),
  'Shift-Mod-7': toggleList(nodes.ordered_list),
  'Shift-Mod-8': toggleList(nodes.bullet_list),
})

export const bodyBaseKeymap = keymap(keys)

export function bodyPlugins(): Plugin[] {
  return [bodyInputRules, bodyKeymap, bodyBaseKeymap, history()]
}

export function createBodyState(markdown: string): EditorState {
  return EditorState.create({ doc: markdownToDoc(markdown), plugins: bodyPlugins() })
}

// ---------------------------------------------------------------- marks

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

/** The link over the selection, if it has one. */
export function selectedLink(state: EditorState): string | null {
  const { from, to } = state.selection
  let href: string | null = null
  state.doc.nodesBetween(from, to, (node) => {
    href ??= (marks.link.isInSet(node.marks)?.attrs.href as string | undefined) ?? null
  })
  return href
}

/** Links the selection to `href` (already checked by safeHref), or unlinks it when null. */
export function setLink(state: EditorState, href: string | null): Transaction | null {
  const { from, to, empty } = state.selection
  if (empty) return null
  const tr = closeHistory(state.tr).removeMark(from, to, marks.link)
  return href ? tr.addMark(from, to, marks.link.create({ href })) : tr
}

/** The block type the caret is in, for the toolbar's pressed buttons. */
export function blockOf(state: EditorState): { type: string; level?: number; list?: string } {
  const { block, list } = around(state)
  return {
    type: block.type.name,
    ...(block.type === nodes.heading ? { level: Number(block.attrs.level) } : {}),
    ...(list ? { list: list.type.name } : {}),
  }
}

export const inCode = (state: EditorState) =>
  Boolean(state.selection.$from.parent.type.spec.code) ||
  Boolean(marks.code.isInSet(state.selection.$from.marks()))

// ---------------------------------------------------------------- the slash menu

/** A `/` at the start of a block or after a space, with the words after it. */
export type SlashTrigger = { from: number; to: number; query: string }

export function findSlash(state: EditorState): SlashTrigger | null {
  const { selection } = state
  if (!selection.empty || selection.$from.parent.type.spec.code) return null
  const $from = selection.$from
  const start = Math.max(0, $from.parentOffset - 24)
  const before = $from.parent.textBetween(start, $from.parentOffset, undefined, '￼')
  const match = /(?:^|\s)\/([\p{L}\p{N}]+(?: [\p{L}\p{N}]+)?)?$/u.exec(before)
  if (!match) return null
  const query = match[1] ?? ''
  return { from: $from.pos - query.length - 1, to: $from.pos, query }
}

export type SlashItem = {
  id: string
  label: string
  group: 'kind' | 'blocks' | 'insert'
  /** Words that also find it. */
  keywords: string
  /** The Markdown a person can type instead, shown at the end of the row. */
  hint?: string
  run: Command
}

/** The template a guide starts from: what to check first, the steps, and what to say. */
export function guideSteps(): Fragment {
  const item = () => nodes.list_item.create(null, nodes.paragraph.create())
  return Fragment.from([
    nodes.heading.create({ level: 2 }, bodySchema.text('Before you start')),
    nodes.bullet_list.create(null, [item()]),
    nodes.heading.create({ level: 2 }, bodySchema.text('Steps')),
    nodes.ordered_list.create(null, [item(), item()]),
    nodes.heading.create({ level: 2 }, bodySchema.text('What to tell the person')),
    nodes.paragraph.create(),
  ])
}

const insertSteps: Command = (state, dispatch) => {
  if (dispatch) {
    const { $from } = state.selection
    const empty =
      $from.parent.type === nodes.paragraph && $from.parent.content.size === 0 && $from.depth === 1
    const at = empty ? $from.before() : $from.after(1)
    const tr = closeHistory(state.tr)
    if (empty) tr.replaceWith(at, $from.after(), guideSteps())
    else tr.insert(at, guideSteps())
    // The caret goes into the first item under "Before you start".
    const heading = guideSteps().child(0).nodeSize
    tr.setSelection(TextSelection.create(tr.doc, at + heading + 3))
    dispatch(tr.scrollIntoView())
  }
  return true
}

const insertAt: Command = (state, dispatch) => {
  dispatch?.(state.tr.insertText('@').scrollIntoView())
  return true
}

export function slashItems(kind: string): SlashItem[] {
  return [
    ...(kind === 'guide'
      ? [
          {
            id: 'steps',
            label: 'Steps for this guide',
            group: 'kind' as const,
            keywords: 'template steps guide instruction',
            hint: 'Template',
            run: insertSteps,
          },
        ]
      : []),
    {
      id: 'h2',
      label: 'Heading 2',
      group: 'blocks',
      keywords: 'heading title section h2',
      hint: '##',
      run: toggleHeading(2),
    },
    {
      id: 'h3',
      label: 'Heading 3',
      group: 'blocks',
      keywords: 'heading subheading h3',
      hint: '###',
      run: toggleHeading(3),
    },
    {
      id: 'bullets',
      label: 'Bulleted list',
      group: 'blocks',
      keywords: 'list bullets unordered',
      hint: '-',
      run: toggleList(nodes.bullet_list),
    },
    {
      id: 'numbers',
      label: 'Numbered steps',
      group: 'blocks',
      keywords: 'list numbers ordered steps',
      hint: '1.',
      run: toggleList(nodes.ordered_list),
    },
    {
      id: 'quote',
      label: 'Quote',
      group: 'blocks',
      keywords: 'quote citation',
      hint: '>',
      run: toggleQuote,
    },
    {
      id: 'code',
      label: 'Code block',
      group: 'blocks',
      keywords: 'code sql query',
      hint: '```',
      run: toggleCodeBlock,
    },
    {
      id: 'mention',
      label: 'Mention',
      group: 'insert',
      keywords: 'mention metric market item domain at',
      run: insertAt,
    },
  ]
}

/** The items whose name or words start with the typed words, and that apply where the caret is. */
export function matchSlash(
  items: readonly SlashItem[],
  query: string,
  state: EditorState,
): SlashItem[] {
  const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    const haystack = `${item.label} ${item.keywords}`.toLocaleLowerCase('en').split(/\s+/)
    return (
      words.every((word) => haystack.some((candidate) => candidate.startsWith(word))) &&
      item.run(state)
    )
  })
}

/** Removes the typed `/words`, then runs the item: one undo step takes back both. */
export function runSlash(
  state: EditorState,
  trigger: SlashTrigger,
  item: SlashItem,
): Transaction | null {
  const clear: Command = (current, dispatch) => {
    dispatch?.(current.tr.delete(trigger.from, trigger.to))
    return true
  }
  let result: Transaction | null = null
  sequence(clear, item.run)(state, (tr) => (result = tr))
  return result ? closeHistory(result) : null
}

// ---------------------------------------------------------------- mentions and paste

/** Replaces an @ trigger with a mention chip and a space, and leaves the caret after the space. */
export function insertBodyMention(
  state: EditorState,
  trigger: { from: number; to: number },
  option: Pick<MentionOption, 'key' | 'name'>,
): Transaction {
  const $at = state.doc.resolve(trigger.from)
  const kept = $at.marks().filter((mark) => mark.type !== marks.code && mark.type !== marks.link)
  const node = nodes.mention.create(
    { target: option.key, label: mentionWords(option.name) },
    null,
    kept,
  )
  const after = state.doc.resolve(trigger.to).nodeAfter
  const spaced = after?.isText && /^[\s.,;:!?)]/.test(after.text ?? '')
  const content = spaced ? [node] : [node, bodySchema.text(' ', kept)]
  const tr = closeHistory(state.tr).replaceWith(trigger.from, trigger.to, content)
  return tr
    .setSelection(TextSelection.create(tr.doc, trigger.from + (spaced ? 1 : 2)))
    .scrollIntoView()
}

/**
 * A paste from outside the editor: the text is read as Markdown in the subset, so a pasted list
 * stays a list and anything outside the subset stays the typed text. In a code block it stays text.
 */
export function pasteMarkdown(state: EditorState, text: string): Transaction {
  const tr = closeHistory(state.tr)
  if (state.selection.$from.parent.type.spec.code) return tr.insertText(text).scrollIntoView()
  const doc = markdownToDoc(text.replace(/\r\n?/g, '\n'))
  return tr
    .replaceSelection(Slice.maxOpen(doc.content))
    .scrollIntoView()
    .setMeta('uiEvent', 'paste')
}
