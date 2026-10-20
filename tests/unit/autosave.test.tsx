import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveStatus } from '@/components/form/save-status'
import { readAutosaveBackup, useAutosave } from '@/hooks/use-autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('useAutosave', () => {
  it('saves 800 ms after the last change, not on every keystroke', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'A' },
    })
    expect(result.current.status).toBe('idle')
    rerender({ value: 'Al' })
    await tick(500)
    rerender({ value: 'All' })
    await tick(500)
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('waiting')
    expect(result.current.unsaved).toBe(true)
    await tick(300)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('All')
    expect(result.current.status).toBe('saved')
    expect(result.current.savedAt).toBeInstanceOf(Date)
    expect(result.current.unsaved).toBe(false)
  })

  it('does not save a value that equals what is saved', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: { summary: 'x' } },
    })
    rerender({ value: { summary: 'x' } })
    await tick(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('runs one save at a time and saves the newest value last', async () => {
    const first = deferred()
    const save = vi.fn((value: string) => (value === 'one' ? first.promise : Promise.resolve()))
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: '' },
    })
    rerender({ value: 'one' })
    await tick(800)
    expect(result.current.status).toBe('saving')
    rerender({ value: 'two' })
    await tick(800)
    expect(save).toHaveBeenCalledTimes(1)
    await act(() => {
      first.resolve()
      return first.promise
    })
    await tick(0)
    expect(save.mock.calls.map(([value]) => value)).toEqual(['one', 'two'])
    expect(result.current.status).toBe('saved')
  })

  it('keeps the text on the device and tries again after a failure', async () => {
    let fail = true
    const save = vi.fn(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve()))
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, save, backupKey: 'draft.test' }),
      { initialProps: { value: 'first' } },
    )
    rerender({ value: 'Online sales to Norway paused' })
    await tick(800)
    expect(result.current.status).toBe('failed')
    expect(result.current.retrying).toBe(true)
    expect(readAutosaveBackup('draft.test')).toBe('Online sales to Norway paused')

    await tick(2000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('failed')

    fail = false
    await tick(5000)
    expect(save).toHaveBeenCalledTimes(3)
    expect(result.current.status).toBe('saved')
    expect(readAutosaveBackup('draft.test')).toBeNull()
  })

  it('tries at once on retry, and stops trying when told not to', async () => {
    const save = vi.fn(() => Promise.reject(new Error('409')))
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, save, shouldRetry: () => false }),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    await tick(800)
    expect(result.current.status).toBe('failed')
    expect(result.current.retrying).toBe(false)
    await tick(60_000)
    expect(save).toHaveBeenCalledTimes(1)
    act(() => result.current.retry())
    await tick(0)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves at once on flush', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    await act(async () => result.current.flush())
    expect(save).toHaveBeenCalledWith('b')
    await tick(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('waits while it is not enabled', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { rerender } = renderHook(({ value, enabled }) => useAutosave({ value, save, enabled }), {
      initialProps: { value: 'a', enabled: false },
    })
    rerender({ value: 'b', enabled: false })
    await tick(1000)
    expect(save).not.toHaveBeenCalled()
    rerender({ value: 'b', enabled: true })
    await tick(800)
    expect(save).toHaveBeenCalledWith('b')
  })
})

describe('SaveStatus', () => {
  it('says where the draft stands, in a polite status region', () => {
    const savedAt = new Date(2026, 9, 8, 9, 41)
    const { rerender } = render(<SaveStatus status="saving" savedAt={null} retrying={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saving...')
    rerender(<SaveStatus status="saved" savedAt={savedAt} retrying={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved 09:41')
    rerender(<SaveStatus status="waiting" savedAt={savedAt} retrying={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved 09:41')
  })

  it('says a failed save is not saved, and offers to try now', () => {
    const onRetry = vi.fn()
    render(<SaveStatus status="failed" savedAt={null} retrying onRetry={onRetry} />)
    expect(screen.getByRole('status')).toHaveTextContent('Not saved. Trying again')
    act(() => screen.getByRole('button', { name: 'Try now' }).click())
    expect(onRetry).toHaveBeenCalled()
  })
})
