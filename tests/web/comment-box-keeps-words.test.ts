// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentItem } from '@/components/templates/comment-box/types'

// The comment box keeps the person's words until the post is known: a post, a reply and an edit
// leave the box as it was while the service has not answered, and when it refuses, the words are
// still there with a message and Comment tries again. Nothing is cleared, closed or toasted early.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const WORDS = 'Three careful paragraphs about the Norway numbers.'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toast: vi.fn(),
  post: vi.fn<(...args: unknown[]) => Promise<string>>(),
  edit: vi.fn<(...args: unknown[]) => Promise<void>>(),
  threads: [] as unknown[],
}))

vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: mocks.toastError }) }))
vi.mock('@/lib/comments', () => ({
  useComments: () => mocks.threads,
  useSubjectReactions: () => [],
  useWithdrawable: () => false,
  useCommentActions: () => ({
    post: mocks.post,
    edit: mocks.edit,
    react: vi.fn(),
    reactToSubject: vi.fn(),
    remove: vi.fn(),
    withdraw: vi.fn(),
    resolve: vi.fn(),
  }),
}))

const { CommentBox } = await import('@/components/templates/comment-box')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
beforeEach(() => {
  vi.clearAllMocks()
  mocks.threads = []
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
})

/** One step, and what React does after it (effects, settled promises), before the next. */
const step = (f: () => void) =>
  act(async () => {
    f()
    await Promise.resolve()
  })
const flush = () => step(() => undefined)

async function mount() {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await step(() =>
    root!.render(
      React.createElement(CommentBox, { subject: 'context:itm_1', me: 'Jon Abara', owners: [] }),
    ),
  )
}

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
const button = (name: string) => buttons().find((b) => b.textContent === name)
/** The last of the buttons with this name: a reply's own Reply comes after the comment's. */
const lastButton = (name: string) =>
  buttons()
    .filter((b) => b.textContent === name)
    .at(-1)
const click = (el: Element | undefined) => step(() => void el!.dispatchEvent(clickEvent()))
const clickEvent = () => new MouseEvent('click', { bubbles: true, cancelable: true })
const box = (label: string) =>
  document.querySelector<HTMLElement & { editor: Editor }>(
    `[role="textbox"][aria-label="${label}"]`,
  )

/** Writes into a comment's box, as typing does. */
async function write(label: string, text: string) {
  const editor = box(label)!.editor
  await step(() => void editor.commands.focus('end'))
  await step(() => void editor.commands.insertContent(text))
}

/** A promise the test settles when the service answers. */
const pending = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('a new comment', () => {
  it('keeps its words, and waits, while the service has not answered', async () => {
    const answer = pending<string>()
    mocks.post.mockReturnValue(answer.promise)
    await mount()
    await click(button('Add a comment'))
    await write('Write a comment', WORDS)

    await click(button('Comment'))
    expect(mocks.post).toHaveBeenCalledTimes(1)
    // Sent, not answered: the box holds the words and cannot send them twice.
    expect(box('Write a comment')?.textContent).toBe(WORDS)
    expect(button('Comment')!.disabled).toBe(true)
    await click(button('Comment'))
    expect(mocks.post).toHaveBeenCalledTimes(1)

    await step(() => answer.resolve('c1'))
    // Answered: the box closes, and nothing was said of a failure.
    expect(box('Write a comment')).toBeNull()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps its words when the post fails, says so, and posts on the next try', async () => {
    mocks.post.mockRejectedValueOnce(new Error('The service is busy.'))
    await mount()
    await click(button('Add a comment'))
    await write('Write a comment', WORDS)

    await click(button('Comment'))
    await flush()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError.mock.calls[0]![0]).toBe("Your comment wasn't saved")
    expect(mocks.toastError.mock.calls[0]![1]).toMatchObject({
      description: 'Your words are still in the box. Try again.',
    })
    // The box is open with what was written, and Comment works again.
    expect(box('Write a comment')?.textContent).toBe(WORDS)
    expect(button('Comment')!.disabled).toBe(false)

    mocks.post.mockResolvedValueOnce('c1')
    await click(button('Comment'))
    expect(mocks.post).toHaveBeenCalledTimes(2)
    expect(mocks.post.mock.calls[1]![1]).toMatchObject({ type: 'doc' })
    expect(box('Write a comment')).toBeNull()
  })
})

const thread: CommentItem = {
  id: 'c1',
  author: 'Jon Abara',
  when: 'Today, 09:40',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
  },
}

describe('a reply', () => {
  it('keeps its words when the post fails, and closes once it went through', async () => {
    mocks.threads = [thread]
    mocks.post.mockRejectedValueOnce(new Error('The service is busy.'))
    await mount()
    await click(button('Reply'))
    await write('Reply to Jon', 'From 1 October.')

    await click(lastButton('Reply'))
    await flush()
    expect(mocks.toastError.mock.calls[0]![0]).toBe("Your reply wasn't saved")
    expect(box('Reply to Jon')?.textContent).toBe('From 1 October.')

    mocks.post.mockResolvedValueOnce('c2')
    await click(lastButton('Reply'))
    expect(box('Reply to Jon')).toBeNull()
  })
})

describe('an edit', () => {
  it('keeps its words when the save fails, and closes once it went through', async () => {
    mocks.threads = [thread]
    mocks.edit.mockRejectedValueOnce(new Error('The service is busy.'))
    await mount()
    await step(() => {
      const more = document.querySelector('[aria-label="More for Jon Abara\'s comment"]')!
      more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      more.dispatchEvent(clickEvent())
    })
    const edit = [...document.querySelectorAll('[role="menuitem"]')].find((m) =>
      /Edit/.test(m.textContent ?? ''),
    )
    await click(edit)
    await write('Edit your comment', ' And the Spanish ones.')

    await click(button('Save'))
    await flush()
    expect(mocks.toastError.mock.calls[0]![0]).toBe("Your changes weren't saved")
    expect(box('Edit your comment')?.textContent).toBe('First And the Spanish ones.')

    mocks.edit.mockResolvedValueOnce()
    await click(button('Save'))
    expect(box('Edit your comment')).toBeNull()
  })
})
