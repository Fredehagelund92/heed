import { describe, expect, it } from 'vitest'
import { initialsOf } from '../../src/server/modules/auth/people.ts'

describe('initialsOf', () => {
  it('takes the first letter of the first and the last word', () => {
    expect(initialsOf('Maria Lindqvist')).toBe('ML')
    expect(initialsOf('  sofia  berg ')).toBe('SB')
    expect(initialsOf('Cher')).toBe('C')
    expect(initialsOf('Åsa van der Öst')).toBe('ÅÖ')
  })

  it('skips words that start with neither a letter nor a digit', () => {
    expect(initialsOf('Practice Owner (invented)')).toBe('PO')
    expect(initialsOf('Jon Eriksen - contractor')).toBe('JC')
    expect(initialsOf('(invented)')).toBe('(')
  })
})
