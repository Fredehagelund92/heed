import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readDevPeople } from '../../src/server/modules/auth/dev-sign-in.ts'
import { SignInChoices } from '@/components/sign-in/sign-in-form'
import { people as referencePeople } from '@/mocks/reference-data'

const noop = () => undefined
const maria = {
  email: 'per_maria@example.test',
  name: 'Maria Lindqvist',
  initials: 'ML',
  roles: [],
  assignments: [],
}

describe('the sign-in methods', () => {
  it('show the demo picker only while the service offers demo people', () => {
    const { unmount } = render(<SignInChoices people={[maria]} onSignIn={noop} />)
    expect(screen.getByRole('combobox', { name: 'Sign in as' })).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    unmount()
    // Production: the dev connector is refused, so nobody is listed and no picker shows.
    render(<SignInChoices people={[]} company={{ href: '/company' }} onSignIn={noop} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo')).not.toBeInTheDocument()
    expect(screen.queryByText(/demo person/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Continue with your company account' }),
    ).toBeInTheDocument()
  })

  it('say that nobody can sign in when there is no method at all', () => {
    render(<SignInChoices people={[]} onSignIn={noop} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No one can sign in here yet' })).toBeInTheDocument()
  })
})

describe('the local persona file', () => {
  it('parses, and each seeded persona is a person the demo seed gives roles to', async () => {
    const personas = await readDevPeople('db/seed/people.local.yml')
    expect(personas[0]).toMatchObject({ roles: ['administrator'] })
    const seeded = personas.filter((p) => p.email.startsWith('per_'))
    expect(seeded.length).toBeGreaterThan(5)
    for (const persona of seeded) {
      const id = persona.email.replace('@example.test', '')
      expect(referencePeople.find((p) => p.id === id)?.name, persona.email).toBe(persona.name)
    }
  })
})
