import type { Person } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'

/** People as the front end names them: owners, proposers and the signed-in person. */
export interface PeopleService {
  /** Everyone, by name. Erased people keep their id and their pseudonymised name, so history still reads. */
  list(): Promise<Person[]>
}

/**
 * The first letter of the first and the last word of a name: "Maria Lindqvist" is "ML". A word
 * that starts with neither a letter nor a digit, such as "(invented)", does not count.
 */
export function initialsOf(name: string): string {
  const all = name.trim().split(/\s+/)
  const named = all.filter((word) => /^[\p{L}\p{N}]/u.test(word))
  const words = named.length ? named : all
  const first = [...(words[0] ?? '')][0] ?? ''
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export const toPerson = (row: { id: string; name: string }): Person => ({
  id: row.id,
  name: row.name,
  initials: initialsOf(row.name),
})

export function createPeopleService(database: Queryable): PeopleService {
  return {
    async list() {
      const rows = await database.query<{ id: string; name: string }>(
        `select id::text, display_name as name from people
          order by display_name collate "en-x-icu", id`,
      )
      return rows.map(toPerson)
    },
  }
}
