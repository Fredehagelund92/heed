import { expect, type Page } from '@playwright/test'

/** Maria's demo week in the mock (src/web/api/mock-demo-proposals.ts), one title per state. */
export const proposalTitles = {
  draft: 'Discount cost in Spain includes a one-off welcome campaign in October.',
  waiting: 'Reporting from the payment provider is down for the United Kingdom.',
  inReview: 'Units sold lags by two days in Cube',
  changesRequested: 'Online sales to Norway stopped on 4 August 2026 after a new customs rule.',
  accepted: 'First-time buyers excludes test accounts and accounts closed within a day.',
  rejected: 'Orders in Poland dropped on 22 September 2026 after a payment provider change.',
  withdrawn: 'Marketplace sign-ups in September were counted twice in Cube.',
} as const

/**
 * Opens a proposal's page from the Proposals page, the way a person does: its title opens it in
 * the docked panel, and the panel's expand opens the page.
 */
export async function openProposal(page: Page, title: string) {
  await page
    .getByRole('table', { name: 'Your proposals' })
    .getByRole('link', { name: title })
    .click()
  await page.locator('[data-slot="dock-panel"]').getByRole('link', { name: 'Open page' }).click()
  await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+/)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('list', { name: 'History' })).toBeVisible()
}
