import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasHeldAction, holdAction, HOLD_MS, undoHeldAction } from '@/lib/held-action'
import { connectToasts, type ToastMessage } from '@/lib/toast'

/** A toast region that keeps what it was given and closes as the real one does. */
function region() {
  const shown = new Map<string, ToastMessage>()
  const disconnect = connectToasts(
    (message) => {
      if (message.id) shown.set(message.id, message)
    },
    (id) => {
      const message = shown.get(id)
      shown.delete(id)
      message?.onClose?.()
    },
  )
  return { shown, disconnect }
}

let toasts: ReturnType<typeof region> | null = null
afterEach(() => toasts?.disconnect())

describe('a step held for Undo (FR-223, contract 9.4)', () => {
  it('shows Undo for 8 seconds and sends only when the toast closes', () => {
    toasts = region()
    const send = vi.fn()
    const undone = vi.fn()
    holdAction({ title: '3 proposals accepted', send, undone })
    const [toast] = [...toasts.shown.values()]
    expect(toast).toMatchObject({ title: '3 proposals accepted', timeout: HOLD_MS })
    expect(toast?.action?.label).toBe('Undo')
    expect(HOLD_MS).toBe(8000)
    expect(hasHeldAction()).toBe(true)
    expect(send).not.toHaveBeenCalled()
    toast?.onClose?.()
    expect(send).toHaveBeenCalledOnce()
    expect(undone).not.toHaveBeenCalled()
    expect(hasHeldAction()).toBe(false)
  })

  it('takes the step back with Undo, or Command Z, before anything is sent', () => {
    toasts = region()
    const send = vi.fn()
    const undone = vi.fn()
    holdAction({ title: 'One', send, undone })
    ;[...toasts.shown.values()][0]?.action?.onClick()
    expect(undone).toHaveBeenCalledOnce()
    // Closing the toast after Undo sends nothing.
    expect(send).not.toHaveBeenCalled()
    expect(toasts.shown.size).toBe(0)

    const second = vi.fn()
    holdAction({ title: 'Two', send: second, undone })
    undoHeldAction()
    expect(undone).toHaveBeenCalledTimes(2)
    expect(second).not.toHaveBeenCalled()
  })

  it('sends what is held when the page is left', () => {
    toasts = region()
    const send = vi.fn()
    holdAction({ title: 'Held', send, undone: () => undefined })
    window.dispatchEvent(new Event('pagehide'))
    expect(send).toHaveBeenCalledOnce()
    expect(hasHeldAction()).toBe(false)
  })
})
