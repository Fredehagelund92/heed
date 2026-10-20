/**
 * Mock scenarios let a person or a test see every state of the library without a server:
 * a first run, a nearly empty library, a quiet one (nothing changed lately, no known data issue),
 * a slow load, a failed load, a failed refresh and a signed-out visit. Four are for the catalogue: a vocabulary with no terms, a definition source
 * whose newest read failed, a definition the newest read no longer lists (Gross margin), and
 * no address for the model folder (`sources.cube_model_url` off, so no model file link). Three are
 * for the assistant: its daily spending limit reached, an answer that fails part way, and a
 * refusal. Two are for Settings: a history log whose hash chain no longer checks out, and a job
 * runner that is not running. One is for Editions: an earlier edition that cannot come back,
 * because a check on a version it served failed after that version left service. One is for the
 * Bin: three items an administrator moved out of the library. One is for Sources: a vocabulary
 * from before a term could name several views, whose Market links one of the two views that have
 * it, so Propose terms offers to link the other. One is for Proposals: terms Ravi, the
 * administrator, proposed himself, which he decides too. Set one with `localStorage.setItem('cl.mock-scenario', 'empty')` and
 * reload, or use the links on the design preview page. Production builds of the app ignore it.
 */
export const mockScenarios = [
  'empty',
  'few',
  'quiet',
  'slow',
  'error',
  'refresh-fails',
  'signed-out',
  'no-terms',
  'source-down',
  'definition-gone',
  'no-model-url',
  'no-areas',
  'areas-error',
  'assistant-limit',
  'assistant-fails',
  'assistant-refuses',
  'audit-broken',
  'runner-stopped',
  'rollback-blocked',
  'binned',
  'term-in-one-view',
  'own-proposals',
] as const
export type MockScenario = (typeof mockScenarios)[number]

export const MOCK_SCENARIO_KEY = 'cl.mock-scenario'

/**
 * The person the mock signs in, by fixture id: `localStorage.setItem('cl.mock-person',
 * 'per_jon')` and reload to be Jon, the owner of Sales and Sandbox. Maria otherwise.
 */
export const MOCK_PERSON_KEY = 'cl.mock-person'
export const DEFAULT_MOCK_PERSON = 'per_maria'

/**
 * A production build of the app ignores these controls. Storybook is built in production mode
 * too, and its stories set them, so its Vite config turns them back on (VITE_MOCK_CONTROLS).
 */
const controlsOn =
  import.meta.env.MODE !== 'production' || import.meta.env.VITE_MOCK_CONTROLS === 'true'

function stored(key: string): string | null {
  if (!controlsOn) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function mockScenario(): MockScenario | null {
  const value = stored(MOCK_SCENARIO_KEY)
  return (mockScenarios as readonly (string | null)[]).includes(value)
    ? (value as MockScenario)
    : null
}

export function mockPersonId(): string {
  return stored(MOCK_PERSON_KEY) ?? DEFAULT_MOCK_PERSON
}

/**
 * Outside production builds, `window.heedMock` is the page's mock world, so a person or a test
 * can act as someone else in it without a reload, and watch the change arrive on the live
 * stream: `heedMock.as('per_jon').claimProposal({ id, revision })`.
 */
export function exposeMockWorld(world: { as: (personId: string) => unknown }) {
  if (controlsOn) Object.assign(window, { heedMock: world })
}
