import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'
import { proposalTitles } from './proposals-support'

/*
  Live updates and the notifications bell (slice W7) on the mock binding: another person's change
  reaches an open page through the mock's live stream, without a reload; the bell lists, opens,
  archives and reads notifications; and the open bell passes axe and fits every width. The mock
  world is the page's own, so a test plays the other person with `window.heedMock` (outside
  production builds only, see src/web/api/mock-scenario.ts). The same flow on the real service
  is tests/e2e-api/live.spec.ts.
*/

type MockWorld = {
  as: (personId: string) => {
    listReviewQueue: () => { id: string; title: string; revision: number }[]
    decide: (input: object) => unknown
    createProposal: (input: object) => { id: string; revision: number }
    submitProposal: (input: object) => unknown
  }
}

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

/** Counts full page loads after the first, so a test can prove nothing reloaded. */
function countReloads(page: Page) {
  let loads = 0
  page.on('load', () => (loads += 1))
  return () => loads - 1
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications(, \d+ unread)?$/ })

/** The bell's unread count, once the bell has read it (the demo week leaves some unread). */
async function unreadCount(page: Page): Promise<number> {
  await expect(bell(page)).toHaveAccessibleName(/, \d+ unread$/)
  const name = (await bell(page).getAttribute('aria-label')) ?? ''
  return Number(/, (\d+) unread/.exec(name)?.[1] ?? 0)
}

test.describe('live updates on the mock', () => {
  test("an owner's decision reaches the writer's list, bell and count without a reload", async ({
    page,
  }) => {
    const reloads = countReloads(page)
    await openPage(page, '/proposals', { width: 1440, height: 900, theme: 'light' })
    const list = page.getByRole('table', { name: 'Your proposals' })
    const row = list.getByRole('row').filter({ hasText: proposalTitles.inReview })
    await expect(row).toContainText('In review')
    const before = await unreadCount(page)

    await page.evaluate((title) => {
      const jon = (window as unknown as { heedMock: MockWorld }).heedMock.as('per_jon')
      const proposal = jon.listReviewQueue().find((candidate) => candidate.title === title)!
      jon.decide({
        id: proposal.id,
        revision: proposal.revision,
        outcome: 'request_changes',
        reason: 'Name the release note of the source tool.',
      })
    }, proposalTitles.inReview)

    await expect(row).toContainText('Changes requested')
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${before + 1} unread`)
    await expect(page.getByRole('status').filter({ hasText: 'New notification' })).toHaveText(
      `New notification: Jon Abara asked for changes: ${proposalTitles.inReview}`,
    )
    expect(reloads()).toBe(0)
  })

  test("a new submission reaches the owner's count and bell without a reload", async ({ page }) => {
    await signInAs(page, 'per_jon')
    const reloads = countReloads(page)
    await openPage(page, '/library', { width: 1440, height: 900, theme: 'light' })
    const queue = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByLabel(/^\d+ to review$/)
    await expect(queue).toBeVisible()
    const waiting = Number((await queue.getAttribute('aria-label'))!.split(' ')[0])
    const before = await unreadCount(page)

    await page.evaluate(() => {
      const maria = (window as unknown as { heedMock: MockWorld }).heedMock.as('per_maria')
      const created = maria.createProposal({
        draft: {
          areaId: 'area_sales',
          kind: 'event',
          summary: 'Online sales to France stopped on 1 October 2026',
          scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
          validity: { start: '2026-10-01', end: null },
          evidence: [
            {
              url: 'https://example.test/france',
              quote: 'Online sales stopped',
              date: '2026-10-01',
            },
          ],
        },
      })
      maria.submitProposal({ id: created.id, revision: created.revision })
    })

    await expect(queue).toHaveAccessibleName(`${waiting + 1} to review`)
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${before + 1} unread`)
    await bell(page).click()
    const panel = page.getByRole('dialog', { name: 'Notifications' })
    await expect(panel.getByRole('link').first()).toHaveAccessibleName(
      'Unread: Maria Lindqvist sent a proposal for review: Online sales to France stopped on 1 October 2026',
    )
    expect(reloads()).toBe(0)
  })
})

test.describe('the notifications bell', () => {
  test('opens a notification, archives one and marks everything read', async ({ page }) => {
    await openPage(page, '/proposals', { width: 1440, height: 900, theme: 'light' })
    const unread = await unreadCount(page)
    expect(unread).toBeGreaterThan(2)
    await bell(page).click()
    const panel = page.getByRole('dialog', { name: 'Notifications' })
    const notes = panel.getByRole('list', { name: 'Notifications' }).getByRole('listitem')
    await expect(notes.first()).toBeVisible()
    const total = await notes.count()

    // Archive the second notification: it leaves the inbox for the Archived view, read.
    const second = notes.nth(1)
    const archived = (await second.getByRole('link').textContent()) ?? ''
    await second.hover()
    await second.getByRole('button', { name: /^Archive:/ }).click()
    await expect(notes).toHaveCount(total - 1)
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${unread - 1} unread`)
    await panel.getByRole('tab', { name: 'Archived' }).click()
    const archive = panel.getByRole('list', { name: 'Archived notifications' })
    await expect(archive.getByRole('listitem').first()).toContainText(
      archived.replace(/^Unread: /, '').split(':')[0]!,
    )
    await panel.getByRole('tab', { name: 'Inbox' }).click()

    // Mark all read: the count and the dots go.
    await panel.getByRole('button', { name: 'Mark all read' }).click()
    await expect(bell(page)).toHaveAccessibleName('Notifications')
    await expect(panel.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
    await expect(panel.locator('[data-unread]')).toHaveCount(0)

    // Opening one leads to what it is about and closes the bell.
    await notes.first().getByRole('link').click()
    await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
    await expect(panel).toBeHidden()
  })

  test('marks a notification read when it is opened', async ({ page }) => {
    await openPage(page, '/proposals', { width: 1440, height: 900, theme: 'light' })
    const unread = await unreadCount(page)
    await bell(page).click()
    const panel = page.getByRole('dialog', { name: 'Notifications' })
    const first = panel.getByRole('list', { name: 'Notifications' }).getByRole('link').first()
    await expect(first).toHaveAccessibleName(/^Unread: Jon Abara/)
    await first.click()
    await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${unread - 1} unread`)
  })
})

for (const size of widths)
  for (const theme of themes)
    test(`the open bell fits and passes axe at ${size.name}px, ${theme}`, async ({ page }) => {
      await openPage(page, '/proposals', { width: size.width, height: size.height, theme })
      await bell(page).click()
      const panel = page.getByRole('dialog', { name: 'Notifications' })
      await expect(panel.getByRole('listitem').first()).toBeVisible()
      await settle(page)
      const box = (await panel.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width)
      if (size.width < 768) {
        expect(box.x).toBe(0)
        expect(box.width).toBe(size.width)
        expect(Math.round(box.y + box.height)).toBe(size.height)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        axe.violations.map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([])
    })
