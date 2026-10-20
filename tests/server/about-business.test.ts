import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingSchemas } from '../../src/contract/admin.ts'
import { ABOUT_BUSINESS_STARTER } from '../../src/domain/about-business.ts'

/*
  About our business starts with the starter text that Administration's reset puts back: the
  baseline migration that writes it and the domain must hold the same words, and the setting must
  accept them as stored.
*/

const baseline = readFileSync(
  new URL('../../db/migrations/0001_baseline.sql', import.meta.url),
  'utf8',
)

/** The text of a PostgreSQL escape string literal, E'...'. */
const escapeString = (body: string) =>
  body.replace(/''|\\(.)/g, (match: string, escaped?: string) =>
    match === "''" ? "'" : escaped === 'n' ? '\n' : escaped!,
  )

describe('the baseline migration', () => {
  it('starts the setting with the starter text, as the settings API keeps it', () => {
    const stored = /\('business\.about', 1, E'((?:[^'\\]|''|\\.)*)'/.exec(baseline)?.[1]
    expect(stored).toBeDefined()
    const value = JSON.parse(escapeString(stored!)) as unknown
    expect(value).toBe(ABOUT_BUSINESS_STARTER)
    expect(settingSchemas['business.about'].safeParse(value)).toEqual({
      success: true,
      data: ABOUT_BUSINESS_STARTER,
    })
  })
})
