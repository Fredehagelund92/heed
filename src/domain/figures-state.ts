/*
  How a source's figures in Ask are (FR-716, CON-612): one pure function that Ask's read, the
  figures list, a change of the settings, the web and the mock all ask, instead of each deciding
  from the stored settings what a paused source or a contact who left means.

  A source keeps its figures settings while it is paused, and an admin may change them then; only
  Ask reads no figure from it until it is resumed. A switch that is on with nobody to ask, or with
  no token to read with, is broken: Ask reads no figure, and the page says what to fix.
*/

export const figuresStates = ['unavailable', 'not_set_up', 'off', 'on', 'held', 'broken'] as const
/**
 * - `unavailable`: its connector reads no figures, or the source is disconnected
 * - `not_set_up`: the switch is off, and no endpoint or no token is set
 * - `off`: set up, the switch off
 * - `on`: Ask reads figures from it
 * - `held`: the switch on, the source paused: off in Ask until it is resumed
 * - `broken`: the switch on, but the endpoint or the token is gone, or the data contact left
 */
export type FiguresState = (typeof figuresStates)[number]

export interface FiguresStateInput {
  /** Its connector reads figures. */
  capable: boolean
  /** It was disconnected. */
  removed: boolean
  /** An admin paused reading it. */
  paused: boolean
  /** Show figures in Ask. */
  switchOn: boolean
  endpoint: boolean
  token: boolean
  /** Its data contact is a member of the workspace; false for none. */
  contactActive: boolean
}

export function figuresState(source: FiguresStateInput): FiguresState {
  if (!source.capable || source.removed) return 'unavailable'
  if (!source.switchOn) return source.endpoint && source.token ? 'off' : 'not_set_up'
  if (!source.endpoint || !source.token || !source.contactActive) return 'broken'
  return source.paused ? 'held' : 'on'
}
