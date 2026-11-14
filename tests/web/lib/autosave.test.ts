import { describe, expect, it } from 'vitest'
import {
  autosaveStart,
  autosaveStep,
  saveStateOf,
  type Autosave,
  type AutosaveEvent,
  type Merge,
} from '@/lib/autosave'

// The autosave machine of #193, one row of its table per test: Saved only when what is stored is
// what is shown, one save in flight at a time, and a failed save keeps what it carried.

const run = <T>(events: AutosaveEvent<T>[], merge?: Merge<T>) =>
  events.reduce<Autosave<T>>((s, e) => autosaveStep(s, e, merge), autosaveStart)
const edit = <T>(value: T): AutosaveEvent<T> => ({ type: 'edit', value })
const send = { type: 'send' } as const
const answered = { type: 'answered' } as const
const failed = { type: 'failed' } as const
const discard = { type: 'discard' } as const

describe('autosave', () => {
  it('opens clean, and an edit waits to be sent', () => {
    expect(saveStateOf(autosaveStart, true)).toBe('clean')
    expect(saveStateOf(run([edit('Alpha')]), true)).toBe('dirty')
  })

  it('says Saved once the answer comes and nothing newer waits', () => {
    const s = run([edit('Alpha'), send])
    expect(s.sending).toBe('Alpha')
    expect(saveStateOf(s, true)).toBe('saving')
    expect(saveStateOf(autosaveStep(s, answered), true)).toBe('saved')
  })

  it('keeps words typed while a save is on its way, and sends them after its answer', () => {
    const s = run([edit('Alpha'), send, edit('Alpha Beta'), answered])
    expect(s.waiting).toBe('Alpha Beta')
    expect(saveStateOf(s, true)).toBe('dirty')
    expect(autosaveStep(s, send).sending).toBe('Alpha Beta')
  })

  it('sends one save at a time', () => {
    const s = run([edit('Alpha'), send, edit('Alpha Beta')])
    expect(autosaveStep(s, send)).toBe(s)
  })

  it('a failed save says Not saved and keeps what it carried, merged with what came after', () => {
    const merge: Merge<Record<string, string>> = (a, b) => ({ ...a, ...b })
    const s = run<Record<string, string>>(
      [edit({ name: 'Sales' }), send, edit({ text: 'House rules' }), failed],
      merge,
    )
    expect(saveStateOf(s, true)).toBe('failed')
    expect(s.waiting).toEqual({ name: 'Sales', text: 'House rules' })
    // Try again, or the next edit, sends it all.
    expect(autosaveStep(s, send, merge).sending).toEqual({ name: 'Sales', text: 'House rules' })
    expect(saveStateOf(autosaveStep(s, edit({ text: 'More' }), merge), true)).toBe('dirty')
  })

  it('drops what waits when the page no longer shows it, so an older text is never sent', () => {
    const s = run([edit('Alpha'), discard])
    expect(s.waiting).toBeNull()
    expect(autosaveStep(s, send)).toBe(s)
    expect(saveStateOf(s, true)).toBe('clean')
    const failedThenDropped = run([edit('Alpha'), send, failed, discard])
    expect(failedThenDropped.waiting).toBeNull()
    expect(failedThenDropped.failed).toBe(false)
  })

  it('says Offline when words wait and the app cannot reach the service', () => {
    expect(saveStateOf(run([edit('Alpha')]), false)).toBe('offline')
    expect(saveStateOf(autosaveStart, false)).toBe('clean')
  })
})
