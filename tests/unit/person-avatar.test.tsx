import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AssistantAvatar } from '@/components/assistant/assistant-avatar'
import { PersonAvatar } from '@/components/person-avatar'

const avatarOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="avatar"]')!

describe('PersonAvatar', () => {
  it('takes its tint from the id, so a rename keeps the colour', () => {
    const before = render(
      <PersonAvatar person={{ id: 'per_priya', name: 'Priya Nair', initials: 'PN' }} />,
    )
    const after = render(
      <PersonAvatar person={{ id: 'per_priya', name: 'Priya Shah', initials: 'PS' }} />,
    )
    expect(avatarOf(before.container).dataset.colour).toBe(avatarOf(after.container).dataset.colour)
    expect(avatarOf(before.container).dataset.colour).toBe('3')
  })

  it('paints the initials with the pair of its slot, and keeps the name for a screen reader', () => {
    const { container } = render(
      <PersonAvatar person={{ id: 'per_priya', name: 'Priya Nair', initials: 'PN' }} />,
    )
    const fallback = container.querySelector('[data-slot="avatar-fallback"]')!
    expect(fallback).toHaveTextContent('PN')
    expect(fallback).toHaveClass('bg-avatar-3-bg', 'text-avatar-3-fg')
    expect(avatarOf(container)).toHaveAttribute('title', 'Priya Nair')
  })

  it('hides a decorative avatar from a screen reader and leaves out its tooltip', () => {
    const { container } = render(
      <PersonAvatar person={{ id: 'per_jon', name: 'Jon Abara', initials: 'JA' }} decorative />,
    )
    expect(avatarOf(container)).toHaveAttribute('aria-hidden', 'true')
    expect(avatarOf(container)).not.toHaveAttribute('title')
  })

  it('falls back to the name without an id, and stays grey without either', () => {
    const named = render(<PersonAvatar person={{ name: 'Priya Nair', initials: 'PN' }} />)
    expect(avatarOf(named.container).dataset.colour).toMatch(/^[1-8]$/)
    const nobody = render(<PersonAvatar person={{ name: '', initials: '?' }} />)
    expect(avatarOf(nobody.container).dataset.colour).toBeUndefined()
    expect(nobody.container.querySelector('[data-slot="avatar-fallback"]')).not.toHaveClass(
      'bg-avatar-1-bg',
    )
  })

  it('sizes the avatar by its slot of the size scale', () => {
    for (const size of ['xs', 'sm', 'default', 'md', 'lg'] as const) {
      const { container } = render(
        <PersonAvatar person={{ id: 'per_jon', name: 'Jon Abara', initials: 'JA' }} size={size} />,
      )
      expect(avatarOf(container)).toHaveAttribute('data-size', size)
    }
  })
})

describe('AssistantAvatar', () => {
  it('is the brand blue tint with the bot, sized like a person, and hidden from a screen reader', () => {
    const { container } = render(<AssistantAvatar size="md" />)
    const avatar = container.querySelector('[data-slot="assistant-mark"]')!
    expect(avatar).toHaveAttribute('data-size', 'md')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveClass(
      'bg-assistant-avatar-bg',
      'text-assistant-avatar-fg',
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
