import { type EditorState, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { redo, undo } from 'prosemirror-history'
import { describe, expect, it } from 'vitest'
import {
  createBodyState,
  findSlash,
  insertBodyMention,
  matchSlash,
  pasteMarkdown,
  runSlash,
  selectedLink,
  setLink,
  slashItems,
  toggleHeading,
  toggleList,
  toggleQuote,
} from '@/components/editor/body-commands'
import { bodySchema, docToMarkdown } from '@/components/editor/body-doc'
import { textCheckMatches } from '@/components/editor/text-check'

const { nodes } = bodySchema

/** A state whose caret sits at the end of the text, or on the words `select` names. */
function at(markdown: string, select?: string): EditorState {
  const state = createBodyState(markdown)
  if (select === undefined)
    return state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
  let from = -1
  state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(select))
      from = pos + node.text.indexOf(select)
  })
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, from + select.length)),
  )
}
const run = (state: EditorState, command: Command) => {
  let next = state
  command(state, (tr) => (next = state.apply(tr)))
  return next
}
const md = (state: EditorState) => docToMarkdown(state.doc)

/** Types text through the view, so the input rules run as they do in the browser. */
function typeInto(state: EditorState, text: string): EditorState {
  const view = new EditorView(document.createElement('div'), { state })
  for (const char of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
    )
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
  const result = view.state
  view.destroy()
  return result
}

describe('Markdown as you type', () => {
  it.each([
    ['## ', 'Steps', '## Steps'],
    ['### ', 'Detail', '### Detail'],
    ['- ', 'one', '- one'],
    ['* ', 'one', '- one'],
    ['1. ', 'first', '1. first'],
    ['3. ', 'third', '3. third'],
    ['> ', 'quoted', '> quoted'],
  ])('%j at the start of a line makes the block', (rule, words, expected) => {
    expect(md(typeInto(createBodyState(''), rule + words))).toBe(expected)
  })

  it.each([
    ['say **period** now', 'say **period** now'],
    ['say *might* now', 'say *might* now'],
    ['say _might_ now', 'say *might* now'],
    ['run `count(*)` now', 'run `count(*)` now'],
  ])('closing %j makes the mark', (typed, expected) => {
    expect(md(typeInto(createBodyState(''), typed))).toBe(expected)
  })

  it('leaves arithmetic and words with underscores alone', () => {
    expect(md(typeInto(createBodyState(''), 'Compute 2 * 3 * 4 in snake_case_name'))).toBe(
      'Compute 2 * 3 * 4 in snake_case_name',
    )
  })

  it('makes a code block from three backticks, where Markdown typed stays text', () => {
    const state = typeInto(createBodyState(''), '```')
    expect(state.selection.$from.parent.type).toBe(nodes.code_block)
    expect(md(typeInto(state, '## not a heading'))).toBe('```\n## not a heading\n```')
  })
})

describe('blocks from the / menu and the toolbar', () => {
  it('finds the slash at the start of a line or after a space, with the words after it', () => {
    expect(findSlash(at('/hea'))).toMatchObject({ query: 'hea' })
    expect(findSlash(at('Some text /'))).toMatchObject({ query: '' })
    expect(findSlash(at('and/or'))).toBeNull()
    expect(findSlash(at('```\n/usr\n```'))).toBeNull()
  })

  it('offers the steps template for a guide only, and filters by the typed words', () => {
    const state = at('/')
    expect(matchSlash(slashItems('guide'), '', state)[0]?.id).toBe('steps')
    expect(matchSlash(slashItems('event'), '', state).map((item) => item.id)).not.toContain('steps')
    expect(matchSlash(slashItems('event'), 'num', state).map((item) => item.label)).toEqual([
      'Numbered steps',
    ])
  })

  it('removes the typed /words and makes the block, as one undo step', () => {
    const state = at('Check the source /quo')
    const trigger = findSlash(state)!
    const item = matchSlash(slashItems('note'), trigger.query, state)[0]!
    const next = state.apply(runSlash(state, trigger, item)!)
    expect(md(next)).toBe('> Check the source')
    expect(md(run(next, undo))).toBe('Check the source /quo')
  })

  it('fills an empty body with the guide template, caret in the first item', () => {
    const state = at('/')
    const trigger = findSlash(state)!
    const steps = slashItems('guide')[0]!
    const next = state.apply(runSlash(state, trigger, steps)!)
    expect(next.doc.child(0).textContent).toBe('Before you start')
    expect(next.selection.$from.node(-1).type).toBe(nodes.list_item)
    expect(md(next)).toBe('## Before you start\n\n## Steps\n\n## What to tell the person')
  })

  it('turns a list item into a heading by taking it out of the list first', () => {
    expect(md(run(at('- one\n- two', 'two'), toggleHeading(2)))).toBe('- one\n\n## two')
  })

  it('toggles lists, changes their type and takes an item out again', () => {
    const list = run(at('step'), toggleList(nodes.bullet_list))
    expect(md(list)).toBe('- step')
    const numbered = run(list, toggleList(nodes.ordered_list))
    expect(md(numbered)).toBe('1. step')
    expect(md(run(numbered, toggleList(nodes.ordered_list)))).toBe('step')
    expect(md(run(at('## A heading'), toggleList(nodes.bullet_list)))).toBe('- A heading')
  })

  it('wraps a block in a quote and lifts it out again', () => {
    const quoted = run(at('words'), toggleQuote)
    expect(md(quoted)).toBe('> words')
    expect(md(run(quoted, toggleQuote))).toBe('words')
  })

  it('links the selected words and removes the link again', () => {
    const state = at('Read the notice first', 'the notice')
    const linked = state.apply(setLink(state, 'https://example.com/notice')!)
    expect(md(linked)).toBe('Read [the notice](https://example.com/notice) first')
    expect(selectedLink(linked)).toBe('https://example.com/notice')
    expect(md(linked.apply(setLink(linked, null)!))).toBe('Read the notice first')
  })
})

describe('mentions, paste and the text check in the body', () => {
  it('writes a picked mention as its token, with a space after it', () => {
    const state = at('Check @Dep')
    const next = state.apply(
      insertBodyMention(state, { from: 7, to: 11 }, { key: 'metric:orders', name: 'Orders' }),
    )
    expect(md(next)).toBe('Check @[Orders](metric:orders)')
    expect(next.selection.from).toBe(9)
  })

  it('reads pasted text as Markdown in the subset, and keeps the rest as typed text', () => {
    const pasted = at('').apply(
      pasteMarkdown(at(''), '## Steps\n\n1. Check the period\n\n<b>bold</b> | table |'),
    )
    expect(md(pasted)).toBe('## Steps\n\n1. Check the period\n\n<b>bold</b> | table |')
  })

  it('pastes into a code block as plain text', () => {
    const state = typeInto(createBodyState(''), '```')
    expect(md(state.apply(pasteMarkdown(state, '## not a heading')))).toBe(
      '```\n## not a heading\n```',
    )
  })

  it('undoes and redoes typing', () => {
    const typed = typeInto(createBodyState(''), 'words')
    expect(md(run(typed, undo))).toBe('')
    expect(md(run(run(typed, undo), redo))).toBe('words')
  })

  it('finds an email or a phone number where it is, past a mention', () => {
    const state = at('Ask @[Orders](metric:orders) owner anna.berg@example.com or 555-123-4567')
    const found = textCheckMatches(state.doc)
    expect(found.map((match) => [match.code, match.words])).toEqual([
      ['email_address', 'anna.berg@example.com'],
      ['phone_number', '555-123-4567'],
    ])
    expect(state.doc.textBetween(found[0]!.from, found[0]!.to)).toBe('anna.berg@example.com')
  })
})
