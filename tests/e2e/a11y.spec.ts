import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  GATEWAY_ADMIN,
  gatewayPages,
  itemPages,
  openPage,
  panelPages,
  previews,
  releasePages,
  routes,
  settingsPages,
  settle,
  themes,
  TRY_IT_MATCH,
  tryItPages,
  widths,
} from './support'

/*
  WCAG 2.2 AA through axe, for every page in both appearances at every width (NFR-111, NFR-112).
  axe cannot find everything. These checks stand beside keyboard and screen reader review.
*/

const targets: readonly { name: string; path: string; person?: string; ready?: string }[] = [
  ...routes,
  ...itemPages,
  ...panelPages,
  ...releasePages,
  { name: 'metric page', path: '/catalogue/metric/orders' },
  {
    name: 'dimension page, a value picked out',
    path: '/catalogue/dimension/market?value=netherlands',
  },
  ...tryItPages,
  ...settingsPages,
  ...previews.map(({ name, path }) => ({ name: `design-preview ${name}`, path })),
]

for (const size of widths) {
  for (const theme of themes) {
    test.describe(`axe at ${size.name}px, ${theme}`, () => {
      for (const target of targets) {
        test(target.name, async ({ page }) => {
          if (target.person)
            await page.addInitScript(
              (person) => window.localStorage.setItem('cl.mock-person', person),
              target.person,
            )
          await openPage(page, target.path, { ...size, theme })
          if (target.ready) await expect(page.locator(target.ready).first()).toBeVisible()
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze()
          const summary = results.violations.map(
            (violation) =>
              `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
          )
          expect(summary).toEqual([])
        })
      }
    })
  }
}

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const size of widths) {
  for (const theme of themes) {
    test.describe(`axe as an administrator at ${size.name}px, ${theme}`, () => {
      for (const target of gatewayPages) {
        test(target.name, async ({ page }) => {
          await page.addInitScript(
            (person) => window.localStorage.setItem('cl.mock-person', person),
            GATEWAY_ADMIN,
          )
          await openPage(page, target.path, { ...size, theme })
          await expect(page.getByRole('tab', { selected: true })).toBeVisible()
          await expect(page.getByRole('status', { name: /^Loading the/ })).toHaveCount(0)
          const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
          expect(results.violations.map((violation) => violation.id)).toEqual([])
        })
      }
    })
  }
}

test.describe('axe with an open overlay', () => {
  for (const theme of themes) {
    test(`command palette, ${theme}`, async ({ page }) => {
      await openPage(page, '/', { ...widths[0], theme })
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`command palette with catalogue results, ${theme}`, async ({ page }) => {
      await openPage(page, '/catalogue', { ...widths[0], theme })
      await page.keyboard.press('Control+k')
      const dialog = page.getByRole('dialog', { name: 'Command palette' })
      await expect(dialog).toBeVisible()
      await page.keyboard.type('mar')
      await expect(dialog.getByRole('group', { name: 'Catalogue' })).toBeVisible()
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`Report a gap with a refused note, ${theme}`, async ({ page }) => {
      await openPage(page, TRY_IT_MATCH, { ...widths[0], theme })
      await page.getByRole('button', { name: 'Report a gap' }).click()
      const dialog = page.getByRole('dialog', { name: 'Report a gap' })
      await dialog.getByRole('textbox').fill('Mail someone@example.test')
      await dialog.getByRole('button', { name: 'Report gap' }).click()
      await expect(dialog.getByText(/an email address/)).toBeVisible()
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`client editor with its errors, ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (person) => window.localStorage.setItem('cl.mock-person', person),
        GATEWAY_ADMIN,
      )
      await openPage(page, '/admin?section=gateway', { ...widths[0], theme })
      await page.getByRole('button', { name: 'Add an agent' }).click()
      const dialog = page.getByRole('dialog', { name: 'Add an agent' })
      await dialog.getByRole('button', { name: 'Add agent' }).click()
      await expect(dialog.getByRole('alert')).toBeVisible()
      await dialog.getByRole('radio', { name: 'Only the tools chosen below' }).check()
      await dialog.getByRole('button', { name: 'Add agent' }).click()
      await expect(dialog).toContainText('Fix these 4 problems first')
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`Give a role with people, domains and its outcome, ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (person) => window.localStorage.setItem('cl.mock-person', person),
        GATEWAY_ADMIN,
      )
      await openPage(page, '/admin?section=people', { ...widths[0], theme })
      await page.getByRole('button', { name: 'Give a role' }).click()
      const dialog = page.getByRole('dialog', { name: 'Give a role' })
      for (const [field, text, option] of [
        ['People', 'Kofi', /Kofi Mensah/],
        ['Domains', 'Mark', /Marketing/],
      ] as const) {
        await dialog.getByRole('combobox', { name: field }).fill(text)
        await page.getByRole('option', { name: option }).click()
      }
      await expect(dialog.locator('[data-slot="give-outcome"]')).toBeVisible()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`Add owners on the Team tab, ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (person) => window.localStorage.setItem('cl.mock-person', person),
        GATEWAY_ADMIN,
      )
      await openPage(page, '/health?open=domain:area_marketing&tab=team', { ...widths[0], theme })
      await page.getByRole('button', { name: 'Add owners' }).click()
      const give = page.getByRole('dialog', { name: 'Give a role' })
      await give.getByRole('button', { name: 'Give role' }).click()
      await expect(give).toContainText('Choose a person.')
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`people selected, and a role removed from them together, ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (person) => window.localStorage.setItem('cl.mock-person', person),
        GATEWAY_ADMIN,
      )
      await openPage(page, '/admin?section=people', { ...widths[0], theme })
      await page.getByRole('checkbox', { name: 'Select every person shown' }).check()
      const bar = page.getByRole('region', { name: 'Selected people' })
      await expect(bar).toBeVisible()
      await settle(page)
      let results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
      await bar.getByRole('button', { name: 'Remove a role' }).click()
      const remove = page.getByRole('dialog', { name: /^Remove a role from \d+ people$/ })
      await remove.getByRole('button', { name: 'Remove role' }).click()
      await expect(remove).toContainText('Choose a role to remove.')
      await settle(page)
      results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`tool switch, ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (person) => window.localStorage.setItem('cl.mock-person', person),
        GATEWAY_ADMIN,
      )
      await openPage(page, '/admin?section=gateway&tab=tools', { ...widths[0], theme })
      await page.getByRole('switch', { name: 'Get context for a question' }).click()
      await expect(
        page.getByRole('alertdialog', { name: 'Switch off Get context for a question?' }),
      ).toBeVisible()
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    for (const size of widths)
      test(`assistant panel at ${size.name}px, ${theme}`, async ({ page }) => {
        await openPage(page, '/library', { ...size, theme })
        await page.locator('[data-slot="assistant-launcher"]').click()
        await expect(
          page.getByRole((page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region', {
            name: 'Assistant',
          }),
        ).toBeVisible()
        await settle(page)
        const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
        expect(results.violations.map((violation) => violation.id)).toEqual([])
      })

    // Going back and the stop switch (Editions design S5): the real effect first, a refusal that
    // names the versions, and the confirmation, at a desk and on a phone.
    for (const size of [widths[0], widths[2]])
      for (const step of ['effect', 'refused', 'confirm'] as const)
        test(`go back, ${step}, at ${size.name}px, ${theme}`, async ({ page }) => {
          await page.addInitScript((blocked) => {
            window.localStorage.setItem('cl.mock-person', 'per_ravi')
            if (blocked) window.localStorage.setItem('cl.mock-scenario', 'rollback-blocked')
          }, step === 'refused')
          const label = step === 'refused' ? '2026-08-02.1' : '2026-10-02.1'
          await openPage(page, `/editions/${label}`, { ...size, theme })
          await page.getByRole('button', { name: `Actions for edition ${label}` }).click()
          await page.getByRole('menuitem', { name: 'Go back to this edition…' }).click()
          const dialog = page.getByRole('alertdialog', { name: /^Go back to how it was on / })
          if (step === 'refused')
            await expect(dialog).toContainText("You can't go back to this edition")
          else await expect(dialog.getByRole('list')).toBeVisible()
          if (step === 'confirm') {
            await dialog.getByRole('button', { name: 'Continue' }).click()
            await dialog.getByRole('button', { name: 'Go back', exact: true }).click()
            await expect(dialog).toContainText('Give a reason.')
          }
          await settle(page)
          const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
          expect(results.violations.map((violation) => violation.id)).toEqual([])
        })

    for (const size of [widths[0], widths[2]])
      test(`stop delivery, its reach, at ${size.name}px, ${theme}`, async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
        await openPage(page, '/editions', { ...size, theme })
        await page.getByRole('button', { name: 'More actions for this edition' }).click()
        await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
        await expect(
          page.getByRole('alertdialog', { name: 'Stop sharing with agents?' }),
        ).toContainText('facts in Customer value. Other domains stay as they are.')
        await settle(page)
        const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
        expect(results.violations.map((violation) => violation.id)).toEqual([])
      })

    test(`user menu, ${theme}`, async ({ page }) => {
      await openPage(page, '/', { ...widths[0], theme })
      await page.getByRole('button', { name: /Maria Lindqvist/ }).click()
      await expect(page.getByRole('menuitem', { name: /Profile and appearance/ })).toBeVisible()
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }
})
