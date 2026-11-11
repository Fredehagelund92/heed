/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { areas, roleGrants } from '../../../db/seed/fixtures/reference-data.ts'
import {
  demoLanding,
  demoProfiles,
  rememberSignedOut,
  signedOutOnPurpose,
} from '@/lib/demo-profiles'

const signIn = vi.hoisted(() => {
  const method: Record<string, unknown> = { kind: 'picker', demo: true, profileLabel: null }
  return { method, people: [] as string[] }
})
vi.mock('@/api', () => ({
  api: {
    getSignInMethod: () => Promise.resolve(signIn.method),
    listSignInPeople: () => Promise.resolve(signIn.people),
  },
}))
const { demoProfilesQuery } = await import('@/api/queries')

type DevPerson = { email: string; name: string; roles?: string[] }
const devPeople = parse(
  readFileSync(
    fileURLToPath(new URL('../../../db/seed/people.local.yml', import.meta.url)),
    'utf8',
  ),
) as DevPerson[]
const idOf = (name: string) => `per_${devPeople.find((p) => p.name === name)!.email.slice(4, -13)}`

describe("the demo's profiles", () => {
  it('are people the demo seeds, and the demo opens as its admin', () => {
    for (const p of demoProfiles)
      expect(
        devPeople.map((d) => d.name),
        p.name,
      ).toContain(p.name)
    expect(demoLanding.name).toBe('Ravi Kapoor')
    expect(roleGrants.administrators).toContain(idOf(demoLanding.name))
  })

  it('say what each person is: an admin, an owner of Sales, a reader who owns and approves nothing', () => {
    const [admin, owner, reader] = demoProfiles.map((p) => idOf(p.name))
    expect(demoProfiles.map((p) => p.part)).toEqual(['Admin', 'Domain owner', 'Reader'])
    expect(roleGrants.administrators).toContain(admin)
    expect(areas.find((a) => a.id === 'area_sales')!.ownerIds).toContain(owner)
    const held = [
      ...areas.flatMap((a) => a.ownerIds),
      ...roleGrants.administrators,
      ...roleGrants.approvers.map((a) => a.personId),
      ...roleGrants.auditors,
    ]
    expect(held).not.toContain(reader)
    expect(devPeople.find((d) => d.name === demoProfiles[2]!.name)!.roles ?? []).toEqual([])
  })

  it('each have one plain line', () => {
    for (const p of demoProfiles) expect(p.line).toMatch(/^[^.]+\.$/)
  })
})

describe('the profiles a signed-in person can view as', () => {
  const names = demoProfiles.map((p) => p.name)
  const read = () => demoProfilesQuery().queryFn!({} as never)

  it('are all of them in the demo', async () => {
    signIn.people = [...names, 'Tomas Eriksen']
    expect((await read()).map((p) => p.name)).toEqual(names)
  })

  it('leave out anyone the service does not offer', async () => {
    signIn.people = names.slice(0, 2)
    expect((await read()).map((p) => p.name)).toEqual(names.slice(0, 2))
  })

  it('are none outside the demo: company sign-in, or an install with its own data', async () => {
    signIn.people = names
    signIn.method = { kind: 'oidc', demo: true, name: 'Acme', start: '/x', profileLabel: null }
    expect(await read()).toEqual([])
    signIn.method = { kind: 'picker', demo: false, profileLabel: 'Mine' }
    expect(await read()).toEqual([])
    signIn.method = { kind: 'picker', demo: true, profileLabel: null }
  })
})

describe('signing out on purpose', () => {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  afterEach(() => store.clear())

  it('is remembered for the tab until someone signs in again', () => {
    expect(signedOutOnPurpose()).toBe(false)
    rememberSignedOut(true)
    expect(signedOutOnPurpose()).toBe(true)
    rememberSignedOut(false)
    expect(signedOutOnPurpose()).toBe(false)
  })

  it('is not remembered where the browser keeps no storage', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => rememberSignedOut(true)).not.toThrow()
    expect(signedOutOnPurpose()).toBe(false)
  })
})
