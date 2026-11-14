import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toast) }))

import { takeBackBy } from '@/lib/undo'

beforeEach(() => toast.error.mockClear())

describe('an Undo the service refuses', () => {
  it('says why, and reports that nothing was taken back', async () => {
    const late = new ApiError(
      'conflict',
      'It is too late to undo this decision. Decide again instead.',
    )
    expect(await takeBackBy(() => Promise.reject(late))).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo it", {
      description: 'It is too late to undo this decision. Decide again instead.',
    })
  })

  it('says nothing when it was taken back', async () => {
    expect(await takeBackBy(() => Promise.resolve())).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('leaves a session that ended to the app, which opens sign-in', async () => {
    const out = new ApiError('signed-out', 'Sign in again.')
    expect(await takeBackBy(() => Promise.reject(out))).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
