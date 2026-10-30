import * as React from 'react'
import { useLibrary, useSession, useWorkspace } from '@/api/queries'
import type { Fact } from '@/model/items'
import type { Domain, Domains, Person } from '@/model/people'

// The shared reads as the screens use them: who is signed in, the workspace's domains and people,
// and the context items. The shell loads them once before it draws (App.tsx), so these read the
// cache and never wait.

const EMPTY: Person = { name: '', role: '', owns: [], admin: false }

/** Someone by name; the first person when nobody matches, as the demo's picker starts. */
export const personIn = (people: Person[], name: string | null) =>
  people.find((p) => p.name === name) ?? people[0] ?? EMPTY

/** The signed-in person. */
export function useMe(): Person {
  const { user } = useSession()
  const { people } = useWorkspace()
  return personIn(people, user)
}

/** The domains by id. */
export function useDomains(): Domains {
  const { domains } = useWorkspace()
  return React.useMemo(() => Object.fromEntries(domains.map((d) => [d.id, d])), [domains])
}

/** The domains in the workspace's order. */
export const useDomainList = (): Domain[] => useWorkspace().domains

export const usePeople = (): Person[] => useWorkspace().people

/** Every context item as it is now. */
export const useFacts = (): Fact[] => useLibrary().items

export function useFact(id: string | undefined) {
  const all = useFacts()
  return all.find((f) => f.id === id)
}
