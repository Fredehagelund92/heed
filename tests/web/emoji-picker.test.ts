// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TEXT_EXTENSIONS } from '@/components/templates/comment-box/extensions'
import { emojiExtension, mentionOpen } from '@/lib/mention-extension'

// The ':' list in a comment's text box, as the composer builds it: a colon alone opens it with the
// short list, letters narrow it, the keys stay in the box (arrows, Enter or Tab, Esc), and the box
// names the list and its active option for screen readers, as it does for '@'.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // jsdom lays nothing out: the list asks where the caret is and scrolls its active row into view.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  const rect = () => new DOMRect(0, 0, 0, 0)
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
})

/** One step, and what React and the list do after it, before the next. */
const step = (f: () => void) =>
  act(async () => {
    f()
    await Promise.resolve()
  })

async function mount() {
  let editor: Editor | null = null
  function Box() {
    const e = useEditor({
      extensions: [...TEXT_EXTENSIONS, emojiExtension()],
      editorProps: { attributes: { 'aria-label': 'Write a comment', role: 'textbox' } },
      immediatelyRender: true,
    })
    editor = e
    return React.createElement(EditorContent, { editor: e })
  }
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await step(() => root!.render(React.createElement(Box)))
  const ed = editor as unknown as Editor
  await step(() => void ed.commands.focus('end'))
  return ed
}

async function type(editor: Editor, text: string) {
  for (const ch of text) await step(() => void editor.commands.insertContent(ch))
}

async function press(editor: Editor, key: string) {
  await step(() => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

const list = () => document.querySelector<HTMLElement>('[role="listbox"]')
const options = () => [...(list()?.querySelectorAll('[role="option"]') ?? [])]
const names = () => options().map((o) => o.textContent)

describe("the ':' list in a comment", () => {
  it('opens on the colon alone with the short list, and narrows as letters follow', async () => {
    const editor = await mount()
    await type(editor, 'Ship it :')
    expect(mentionOpen(editor.state)).toBe(true)
    expect(list()?.getAttribute('aria-label')).toBe('Emoji')
    expect(names()[0]).toBe('👍thumbs up:thumbsup:')
    expect(names().length).toBeLessThanOrEqual(12)
    await type(editor, 'ta')
    expect(names()[0]).toBe('🎉party popper:tada:')
  })

  it('names the list and the active option on the text box, and moves with the arrows', async () => {
    const editor = await mount()
    await type(editor, ':')
    const box = editor.view.dom
    expect(box.getAttribute('aria-autocomplete')).toBe('list')
    expect(box.getAttribute('aria-controls')).toBe(list()!.id)
    const first = box.getAttribute('aria-activedescendant')
    expect(first).toBe(options()[0]!.id)
    await press(editor, 'ArrowDown')
    expect(box.getAttribute('aria-activedescendant')).toBe(options()[1]!.id)
    await press(editor, 'ArrowUp')
    expect(box.getAttribute('aria-activedescendant')).toBe(first)
  })

  it('Enter or Tab adds the active emoji in place of the colon', async () => {
    const editor = await mount()
    await type(editor, 'Ship it :')
    await press(editor, 'ArrowDown')
    await press(editor, 'Enter')
    expect(editor.getText()).toBe('Ship it 👀')
    expect(list()).toBeNull()
    await type(editor, ' :tad')
    await press(editor, 'Tab')
    expect(editor.getText()).toBe('Ship it 👀 🎉')
    expect(editor.view.dom.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('Esc closes it and keeps the colon; it stays closed for that colon', async () => {
    const editor = await mount()
    await type(editor, 'Ship it :')
    await press(editor, 'Escape')
    expect(list()).toBeNull()
    expect(mentionOpen(editor.state)).toBe(false)
    expect(editor.getText()).toBe('Ship it :')
    await type(editor, 't')
    expect(list()).toBeNull()
  })

  it('opens nothing inside a word, a link, a time or a double colon', async () => {
    for (const text of ['Note:', 'See https://wiki', 'Back at 18:30', 'Look ::']) {
      const editor = await mount()
      await type(editor, text)
      expect(mentionOpen(editor.state), text).toBe(false)
      expect(list(), text).toBeNull()
      act(() => root?.unmount())
    }
  })

  it('leaves Enter alone while closed', async () => {
    const editor = await mount()
    await type(editor, 'Back at 18:30')
    expect(mentionOpen(editor.state)).toBe(false)
    await press(editor, 'Enter')
    expect(editor.getText()).not.toContain('👍')
  })
})
