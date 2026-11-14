import { describe, expect, it } from 'vitest'
import {
  figuresState,
  type FiguresState,
  type FiguresStateInput,
} from '../../../src/domain/figures-state.ts'

const source = (over: Partial<FiguresStateInput> = {}): FiguresStateInput => ({
  capable: true,
  removed: false,
  paused: false,
  switchOn: true,
  endpoint: true,
  token: true,
  contactActive: true,
  ...over,
})

describe('how a source’s figures in Ask are', () => {
  const cases: [string, Partial<FiguresStateInput>, FiguresState][] = [
    ['switched on, set up, with a contact', {}, 'on'],
    ['a connector that reads no figures', { capable: false }, 'unavailable'],
    ['disconnected', { removed: true, paused: true }, 'unavailable'],
    ['nothing set yet', { switchOn: false, endpoint: false, token: false }, 'not_set_up'],
    ['an endpoint and no token', { switchOn: false, token: false }, 'not_set_up'],
    ['set up, switched off', { switchOn: false }, 'off'],
    ['set up, switched off, paused', { switchOn: false, paused: true }, 'off'],
    // A paused source keeps its settings: off in Ask, and on again once resumed.
    ['switched on, paused', { paused: true }, 'held'],
    ['switched on, the data contact left', { contactActive: false }, 'broken'],
    ['switched on, the token gone', { token: false }, 'broken'],
    ['switched on, paused, the contact left', { paused: true, contactActive: false }, 'broken'],
  ]

  it.each(cases)('%s', (_name, over, expected) => {
    expect(figuresState(source(over))).toBe(expected)
  })
})
