import { describe, expect, it } from 'vitest'
import { hostOf } from '@/lib/host'

describe('hostOf', () => {
  it('names an https source by its host, without www', () => {
    expect(hostOf('https://www.customs.example/rules/2026')).toBe('customs.example')
  })

  it('keeps a source that is no link in its own words', () => {
    expect(hostOf('mailto:finance@acme.example')).toBe('mailto:finance@acme.example')
    expect(hostOf('the finance team, by email')).toBe('the finance team, by email')
  })
})
