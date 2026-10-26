/**
 * The `HeedApi` conformance suite: the same cases run against the mock binding
 * (tests/app/mock/conformance.test.ts) and against the http binding talking to the real service and
 * PostgreSQL (tests/app/integration/http-api.test.ts). A case names the methods it needs, so it runs
 * against a binding once that binding answers them; the http binding grows its list as the pull
 * requests that wire each screen land.
 */
import { describe, expect, it } from 'vitest'
import { heedApiMethods, type HeedApi, type HeedApiMethod } from '@/api/client'

export type HeedApiConformance = {
  /** Someone the binding's sign-in offers, by name. */
  person: string
  /** The methods the binding answers; a case that needs another is skipped. */
  wired: readonly HeedApiMethod[]
}

export function describeHeedApi(
  name: string,
  getApi: () => HeedApi,
  { person, wired }: HeedApiConformance,
) {
  const api = () => getApi()
  const lacks = (...methods: HeedApiMethod[]) => methods.some((m) => !wired.includes(m))

  describe(`HeedApi conformance: ${name}`, () => {
    it('has every method of the interface', () => {
      for (const method of heedApiMethods) expect(typeof api()[method], method).toBe('function')
    })

    it.skipIf(lacks('listSignInPeople'))('offers the person to sign in as', async () => {
      expect(await api().listSignInPeople()).toContain(person)
    })

    it.skipIf(lacks('signIn', 'getSession', 'signOut'))(
      'signs in, keeps the session, and signs out',
      async () => {
        const session = await api().signIn({ name: person, fresh: false })
        expect(session).toMatchObject({ user: person, fresh: false })
        expect((await api().getSession()).user).toBe(person)
        await api().signOut()
        expect((await api().getSession()).user).toBeNull()
      },
    )

    it.skipIf(lacks('signIn'))('refuses someone the sign-in does not offer', async () => {
      await expect(api().signIn({ name: 'Nobody Here', fresh: false })).rejects.toMatchObject({
        kind: 'not-found',
      })
    })
  })
}
