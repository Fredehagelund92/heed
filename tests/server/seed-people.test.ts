import { describe, expect, it } from 'vitest'
import { people } from '../../db/seed/fixtures/reference-data.ts'
import { readDevPeople } from '../../src/server/modules/auth/dev-sign-in.ts'

describe('the local persona file', () => {
  it('parses, and each seeded persona is a person the demo seed gives roles to', async () => {
    const personas = await readDevPeople('db/seed/people.local.yml')
    expect(personas[0]).toMatchObject({ roles: ['administrator'] })
    const seeded = personas.filter((p) => p.email.startsWith('per_'))
    expect(seeded.length).toBeGreaterThan(5)
    for (const persona of seeded) {
      const id = persona.email.replace('@example.test', '')
      expect(people.find((p) => p.id === id)?.name, persona.email).toBe(persona.name)
    }
  })
})
