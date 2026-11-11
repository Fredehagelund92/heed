/**
 * The demo's three ways in, for a first-time visitor who has no one to be yet: the admin the demo
 * opens as, a domain owner and a plain reader. Each has a line saying what that person can do. The
 * people are the demo's own invented ones (db/seed/people.local.yml), and a test holds each line to
 * the roles the demo seeds them with.
 */
export type DemoProfile = {
  name: string
  /** What they are in the demo, in a word or two. */
  part: string
  /** What they can do, in one line. */
  line: string
}

export const demoProfiles: readonly DemoProfile[] = [
  {
    name: 'Ravi Kapoor',
    part: 'Admin',
    line: 'Sees everything and sets up people, domains and agents.',
  },
  {
    name: 'Jon Abara',
    part: 'Domain owner',
    line: 'Owns Sales: reviews, publishes and archives its context.',
  },
  {
    name: 'Maria Lindqvist',
    part: 'Reader',
    line: 'Reads the published context and can suggest changes to it.',
  },
]

/**
 * The profiles to view as, from the workspace the shell already loaded (so the switch costs no read
 * and never pops in): the demo's own invented company has its sandbox domain, which only the demo's
 * seed makes, and an install with its own data has none. Each profile needs its person to be there.
 */
export function profilesIn(workspace: {
  domains: readonly { sandbox?: boolean }[]
  people: readonly { name: string }[]
}): DemoProfile[] {
  if (!workspace.domains.some((d) => d.sandbox)) return []
  return demoProfiles.filter((p) => workspace.people.some((x) => x.name === p.name))
}

/** Who the demo opens as, so a visitor lands in the app with nothing to pick first. */
export const demoLanding = demoProfiles[0]!

const SIGNED_OUT = 'heed.demo.signed-out'

/**
 * Whether this browser tab signed out on purpose. A demo that opens as the admin on its own leaves
 * a person who signed out at the full list of people, so signing out is never undone for them.
 */
export function signedOutOnPurpose(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT) === '1'
  } catch {
    return false
  }
}

/** Remembers (or forgets) that this tab signed out on purpose. */
export function rememberSignedOut(on: boolean) {
  try {
    if (on) sessionStorage.setItem(SIGNED_OUT, '1')
    else sessionStorage.removeItem(SIGNED_OUT)
  } catch {
    // Without storage the demo simply opens as the admin again.
  }
}
