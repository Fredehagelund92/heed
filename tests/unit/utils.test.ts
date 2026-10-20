import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('lets a caller width replace a component default width', () => {
    expect(cn('w-popover', 'w-dialog')).toBe('w-dialog')
    expect(cn('max-w-popover', 'max-w-reading')).toBe('max-w-reading')
    expect(cn('min-w-0', 'min-w-column-status')).toBe('min-w-column-status')
  })

  it('keeps a type role next to a text colour', () => {
    expect(cn('text-caption', 'text-muted-foreground')).toBe('text-caption text-muted-foreground')
  })
})
