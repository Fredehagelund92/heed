import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ItemReview } from '@/api/client'
import { ReviewStamp } from '@/components/item/review-stamp'
import { AbsenceLine } from '@/components/page/absence-line'
import { acceptedByWords, checkWords, reviewStampView, reviewStampWords } from '@/lib/review-stamp'

const names = {
  person: (id: string) => ({ per_jon: 'Jon Abara', per_ravi: 'Per Ravi' })[id],
  domain: (id: string) => ({ commercial: 'Commercial' })[id],
}
const served = {
  acceptedOn: '2026-08-04',
  by: 'the owner of Commercial',
  edition: '2026-08-04.2',
}
const record: ItemReview = {
  id: 'itm_a0000001',
  version: 2,
  acceptedOn: '2026-08-04',
  acceptedAs: 'owner',
  areaId: 'commercial',
  personId: 'per_jon',
  edition: '2026-08-04.2',
  checks: ['format', 'matching', 'delivery'],
}

describe('the review stamp, in words (FR-326)', () => {
  it("names the person and their role inside Heed, from Heed's own record", () => {
    const view = reviewStampView(served, record, names)!
    expect(view).toEqual({
      acceptedOn: '2026-08-04',
      person: 'Jon Abara',
      role: 'owner of Commercial',
      edition: '2026-08-04.2',
      checks: ['format', 'matching', 'delivery'],
    })
    expect(reviewStampWords(view)).toBe(
      'Accepted 4 Aug 2026 by Jon Abara, owner of Commercial. Checks passed: Complete, Finds the right questions and Reaches agents.',
    )
  })

  it('reads the role alone, as the agent does, until Heed has read who it was', () => {
    const view = reviewStampView(served, undefined, names)!
    expect(view).toMatchObject({ person: null, role: 'owner of Commercial', checks: null })
    expect(reviewStampWords(view)).toBe('Accepted 4 Aug 2026 by the owner of Commercial.')
    expect(acceptedByWords({ person: null, role: 'admin' })).toBe('an admin')
  })

  it('names an administrator by role, and an erased person by role alone', () => {
    const admin = reviewStampView(
      null,
      { ...record, acceptedAs: 'administrator', personId: 'per_ravi' },
      names,
    )!
    expect(acceptedByWords(admin)).toBe('Per Ravi, admin')
    const erased = reviewStampView(null, { ...record, personId: null }, names)!
    expect(acceptedByWords(erased)).toBe('the owner of Commercial')
    // A decision made as a deputy before there were only owners reads as an owner's.
    expect(reviewStampView(null, { ...record, acceptedAs: 'deputy' }, names)!.role).toBe(
      'owner of Commercial',
    )
  })

  it('has nothing to stamp for a fact no one has accepted', () => {
    expect(reviewStampView(null, undefined, names)).toBeNull()
    expect(checkWords(['format'])).toBe('Complete')
  })
})

describe('ReviewStamp and AbsenceLine', () => {
  it('draws one quiet line with the name in the foreground and no edition label', () => {
    render(<ReviewStamp view={reviewStampView(served, record, names)} />)
    const stamp = document.querySelector('[data-slot="review-stamp"]')!
    expect(stamp).toHaveAttribute('data-state', 'accepted')
    expect(screen.getByText('Jon Abara')).toHaveClass('text-foreground')
    // An edition label shows only on the Editions page (docs/design/voice.md).
    expect(stamp).not.toHaveTextContent('2026-08-04.2')
    // The dots are for the eye; a screen reader hears commas.
    for (const dot of stamp.querySelectorAll('[aria-hidden="true"]'))
      expect(dot.textContent?.trim() === '·' || dot.tagName === 'svg').toBe(true)
    expect(stamp).toHaveTextContent('Checks passed')
  })

  it('says a draft is not reviewed yet, and who reviews it', () => {
    render(<ReviewStamp view={null} draft domain="Commercial" />)
    expect(document.querySelector('[data-slot="review-stamp"]')).toHaveAttribute(
      'data-state',
      'pending',
    )
    expect(
      screen.getByText('Not reviewed yet. Agents get it once the owner of Commercial accepts it.'),
    ).toBeVisible()
  })

  it('says a live fact with no accept decision has no review on record', () => {
    render(<ReviewStamp view={null} domain="Commercial" />)
    expect(document.querySelector('[data-slot="review-stamp"]')).toHaveAttribute(
      'data-state',
      'unrecorded',
    )
    expect(
      screen.getByText('No review on record. This fact was added before we kept reviews.'),
    ).toBeVisible()
    expect(screen.queryByText(/Not reviewed yet/)).toBeNull()
  })

  it('states an absence with what was checked and one next step', () => {
    render(
      <AbsenceLine
        title="Nothing written down for this yet"
        action={<button>Start a draft</button>}
      >
        No reviewed fact applies to Orders, Norway.
      </AbsenceLine>,
    )
    const line = document.querySelector('[data-slot="absence-line"]')!
    expect(line).toHaveClass('border-dashed', 'border-input')
    expect(line).toHaveTextContent(
      'Nothing written down for this yetNo reviewed fact applies to Orders, Norway.Start a draft',
    )
  })
})
