import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { contentLeft, openPage, settle, themes, widths } from './support'

/*
  Sources (integrations decision, 12 October 2026) on the mock: Administration's Workspace
  section for the tools Heed reads from. The list and a source's page at 1440 and 390 in both
  themes, the page's issues, views, settings and reads; the model folder address moved there
  from Limits, with the old address following it; Read again; the ways in from Operations, the
  catalogue and the palette; and who may open it. Adding a source: the connectors to choose from,
  the form a connector's manifest declares, a test that keeps nothing and says what it did step by
  step, the token kept as set and never shown, and its settings changed on its page.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const sizes = [widths[0], widths[2]] as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}
async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Administration sections' })
const sourceRow = (page: Page, id: string) => page.locator(`[data-source="${id}"]`)
const sourcePage = (page: Page) => page.locator('[data-slot="source-page"]')

/** The page fits its width, and its content starts at the header's edge. */
async function fits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  expect(await contentLeft(page, '[data-layout="content"]')).toBe(
    await contentLeft(page, '[data-layout="header"]'),
  )
}

for (const size of sizes)
  for (const theme of themes)
    test(`the list and the Cube page at ${size.name}px, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_ravi')
      await openPage(page, '/admin?section=sources', { ...size, theme })
      const cube = sourceRow(page, 'cube')
      await expect(cube).toContainText('Cube local model')
      await expect(cube).toContainText('Up to date')
      await expect(cube).toContainText('2 views have no domain')
      await expect(sourceRow(page, 'demo')).toContainText('Switched off')
      await fits(page, size.width)

      await cube.getByRole('link', { name: 'Cube local model' }).click()
      await expect(page).toHaveURL(/section=sources&source=cube$/)
      await expect(page).toHaveTitle('Cube local model - Sources - Administration - Heed')
      const body = sourcePage(page)
      await expect(body.getByRole('heading', { level: 1, name: 'Cube local model' })).toBeVisible()
      await expect(body.locator('[data-issue="missing_domain"]')).toContainText(
        'operations and segments name no domain in Cube',
      )
      await expect(body.locator('[data-view]')).toHaveCount(7)
      await expect(body.locator('[data-view="operations"]')).toContainText('No domain')
      await expect(body.locator('[data-view="basket"]')).toContainText('Sales')
      await expect(body.locator('[data-server-setting="model_folder"]')).toHaveText('db/seed/cube')
      await expect(body.locator('[data-read]')).toHaveCount(6)
      await expect(body.locator('[data-read="failed"]')).toContainText('Nothing changed')
      await fits(page, size.width)

      // The trail ends with the source's id; Sources leads back to the list (one way back).
      if (size.width >= 768) {
        const trail = page.getByRole('navigation', { name: 'breadcrumb' })
        await expect(trail).toContainText('Administration')
        await expect(trail).toContainText('cube')
        await trail.getByRole('link', { name: 'Sources', exact: true }).click()
      } else {
        await page.getByRole('link', { name: 'Back to Sources' }).click()
      }
      await expect(page).toHaveURL(/section=sources$/)
    })

test('Sources sits in Workspace, before Limits, which no longer holds the model folder', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=limits', desktop)
  await expect(sections(page).getByRole('link')).toContainText(['People', 'Sources', 'Limits'])
  await expect(page.locator('[data-setting="review.default_days"]')).toBeVisible()
  await expect(page.locator('[data-setting="sources.cube_model_url"]')).toHaveCount(0)
  await expect(page.getByText('Definition sources')).toHaveCount(0)
})

test('the model folder address changes on the Cube page, and its old address leads there', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  for (const from of [
    '/admin?section=limits&setting=sources.cube_model_url',
    '/settings?section=limits&setting=sources.cube_model_url',
  ]) {
    await openPage(page, from, desktop)
    await expect(page).toHaveURL(
      /\/admin\?section=sources&source=cube&setting=sources\.cube_model_url$/,
    )
    await expect(
      page
        .locator('[data-slot="dock-panel"]')
        .getByRole('heading', { name: 'Model folder address' }),
    ).toBeVisible()
  }

  // Escape closes the panel, and focus lands on Change, which opens it again.
  const panel = page.locator('[data-slot="dock-panel"]')
  const change = page.getByRole('link', { name: 'Change the model folder address' })
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL(/section=sources&source=cube$/)
  await expect(change).toBeFocused()
  await change.click()
  await expect(page).toHaveURL(/setting=sources\.cube_model_url/)

  await panel.getByRole('textbox', { name: 'Address' }).fill('https://git.example.com/acme/model')
  await panel
    .getByRole('textbox', { name: 'Why', exact: true })
    .fill('The model moved to the company host')
  await panel.getByRole('button', { name: 'Save new version' }).click()
  await expect(page.getByText('Model folder address saved')).toBeVisible()
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
  const value = page.locator('[data-setting-value="sources.cube_model_url"]')
  await expect(value).toHaveText('https://git.example.com/acme/model')
  // The views link their files under the new address.
  await expect(
    sourcePage(page).locator('[data-view="basket"]').getByRole('link', { name: 'basket.yml' }),
  ).toHaveAttribute('href', 'https://git.example.com/acme/model/basket.yml')
})

test('Read again queues the hourly read once', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  await sourcePage(page).getByRole('button', { name: 'Read again' }).click()
  await expect(page.getByText('Reading Cube local model again')).toBeVisible()
  await expect(sourcePage(page)).toContainText('Reading again')
  await expect(sourcePage(page).getByRole('button', { name: 'Read again' })).toHaveCount(0)
})

test('with the job runner stopped, Read again says why it cannot', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await scenario(page, 'runner-stopped')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  // A blocked button stays in the tab order and says why when it is pressed.
  await sourcePage(page).getByRole('button', { name: 'Read again' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText("The job runner isn't running")
})

test('a failed read heads the issues, and nothing changed', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await scenario(page, 'source-down')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  const issue = sourcePage(page).locator('[data-issue]').first()
  await expect(issue).toHaveAttribute('data-issue', 'failed')
  await expect(issue).toContainText("Cube couldn't be read. Nothing changed")
  await expect(sourcePage(page).locator('[data-read]').first()).toHaveAttribute(
    'data-read',
    'failed',
  )
})

test('a definition gone from the model is an issue, and items need a look', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await scenario(page, 'definition-gone')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  await expect(sourcePage(page).locator('[data-issue="gone"]')).toContainText(
    '1 definition is gone from Cube',
  )
  await sourcePage(page).getByRole('link', { name: '3 facts, 5 mentions' }).click()
  await expect(page).toHaveURL(/\/library\?status=needs_check%2Csource_missing/)
})

test('an unknown source says so and leads back to the list', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=sources&source=nothing', desktop)
  await expect(page.locator('[data-slot="source-not-found"]')).toContainText(
    'No source has this name',
  )
  await page.getByRole('link', { name: 'Open the sources' }).click()
  await expect(page).toHaveURL(/section=sources$/)
})

const TOKEN = 'glpat-e2e-readonly-0123456789'
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const form = (page: Page) => page.getByRole('form', { name: /^(Add |Change )/ })
const check = (page: Page) => page.locator('[data-slot="source-check"]')

async function noAxeViolations(page: Page) {
  // A toast fading out is drawn half transparent for a moment, and one may start to fade while
  // axe reads the page: it reads it once the toast (5 seconds) is gone.
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0, { timeout: 10_000 })
  await settle(page)
  const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
  const found = results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary}`),
  }))
  expect(
    found.map((violation) => violation.id),
    JSON.stringify(found, null, 2),
  ).toEqual([])
}

/** Fills the form to add the analytics model from Git, with a token the host refuses. */
async function fillSource(page: Page) {
  const fields = form(page)
  await fields.getByRole('textbox', { name: 'Name', exact: true }).fill('Analytics model')
  await fields
    .getByRole('textbox', { name: 'Repository', exact: true })
    .fill('https://git.example.com/analytics/semantic-layer.git')
  await fields.getByRole('textbox', { name: /^Model folder \(optional\)/ }).fill('cube/model')
  await fields.getByLabel(/^Read-only token/).fill('refused')
  await fields
    .getByRole('textbox', { name: 'Why', exact: true })
    .fill('Read the analytics model from Git')
}

test.describe('adding a source', () => {
  for (const size of sizes)
    for (const theme of themes)
      test(`tests and adds a Cube model in Git at ${size.name}px, ${theme}`, async ({ page }) => {
        // Three axe passes and two layout checks on top of the flow itself.
        test.slow()
        await signInAs(page, 'per_ravi')
        await openPage(page, '/admin?section=sources', { ...size, theme })
        await page.getByRole('link', { name: 'Add a connector' }).click()
        await expect(page).toHaveURL(/section=sources&add=true$/)
        await expect(page).toHaveTitle('Add a connector - Sources - Administration - Heed')
        await expect(page.getByRole('heading', { level: 1, name: 'Add a connector' })).toBeVisible()
        // The connectors, by what they sync: stable ones first.
        const list = page.locator('[data-slot="connectors-definitions"]')
        await expect(list.locator('[data-connector]')).toHaveText([
          /^Cube model in a Git repository/,
          /^Static list of definitions\s*Experimental/,
        ])
        await noAxeViolations(page)
        await fits(page, size.width)
        await list.getByRole('link', { name: 'Cube model in a Git repository' }).click()
        await expect(page).toHaveURL(/section=sources&add=true&connector=cube$/)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Cube model in a Git repository' }),
        ).toBeVisible()
        await expect(page.locator('[data-slot="source-type"]')).toContainText(
          'Read access to this one repository. We never write to it.',
        )
        await expect(page.locator('[data-slot="source-type"]')).toContainText(
          'The host of the repository you give',
        )
        if (size.width >= 768)
          await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
            'Add a connector',
          )

        // Pressing Add connector says what is missing, next to each field, and nothing is sent.
        await form(page).getByRole('button', { name: 'Add connector' }).click()
        await expect(form(page)).toContainText('Give the source a name.')
        await expect(form(page)).toContainText('Give the repository address.')
        await expect(form(page)).toContainText("Say why you're changing it.")
        await expect(form(page).getByRole('textbox', { name: 'Name', exact: true })).toBeFocused()
        await noAxeViolations(page)

        await fillSource(page)
        await form(page).getByRole('button', { name: 'Test connection' }).click()
        await expect(check(page)).toContainText('The token was refused')
        await form(page)
          .getByLabel(/^Read-only token/)
          .fill(TOKEN)
        await form(page).getByRole('button', { name: 'Add a domain name' }).click()
        await form(page).getByRole('textbox', { name: "The tool's name, line 1" }).fill('paid')
        await form(page)
          .getByRole('combobox', { name: 'The domain, line 1' })
          .selectOption({ label: 'Paid media' })
        await form(page).getByRole('button', { name: 'Test connection' }).click()
        await expect(check(page)).toContainText('We can read it, with warnings')
        await expect(check(page)).toContainText('7 views')
        await noAxeViolations(page)
        await fits(page, size.width)

        await form(page).getByRole('button', { name: 'Add connector' }).click()
        await expect(page).toHaveURL(/section=sources&source=analytics-model$/)
        const body = sourcePage(page)
        await expect(body.getByRole('heading', { level: 1, name: 'Analytics model' })).toBeVisible()
        await expect(body.locator('[data-slot="source-issues"]')).toContainText('Not read yet')
        await expect(body.locator('[data-source-setting="repository"]')).toHaveText(
          'https://git.example.com/analytics/semantic-layer.git',
        )
        await expect(body.locator('[data-source-setting="token"]')).toHaveText('Set')
        await expect(body.locator('[data-source-setting="domainNames"]')).toContainText(
          'paid→Paid media',
        )
        // The token is never on screen again, nor in the page's address.
        await expect(page.locator('body')).not.toContainText(TOKEN)
        expect(page.url()).not.toContain(TOKEN)
        await fits(page, size.width)
        await noAxeViolations(page)

        // The mock keeps what was added until the page loads again, so the way back is a link.
        if (size.width >= 768)
          await page
            .getByRole('navigation', { name: 'breadcrumb' })
            .getByRole('link', { name: 'Sources', exact: true })
            .click()
        else await page.getByRole('link', { name: 'Back to Sources' }).click()
        await expect(sourceRow(page, 'analytics-model')).toContainText('Not read yet')
      })

  test('changes an added source: a token left empty is kept', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=sources&add=true&connector=cube', desktop)
    await fillSource(page)
    await form(page)
      .getByLabel(/^Read-only token/)
      .fill(TOKEN)
    await form(page).getByRole('button', { name: 'Add connector' }).click()
    await expect(page).toHaveURL(/source=analytics-model$/)

    await page.getByRole('link', { name: 'Change settings' }).click()
    await expect(page).toHaveURL(/source=analytics-model&edit=true$/)
    await expect(page).toHaveTitle(
      'Change settings - Analytics model - Sources - Administration - Heed',
    )
    const trail = page.getByRole('navigation', { name: 'breadcrumb' })
    await expect(trail).toContainText('Change settings')
    await expect(trail.getByRole('link', { name: 'analytics-model' })).toBeVisible()
    const token = form(page).getByLabel(/^Read-only token/)
    await expect(token).toHaveValue('')
    await expect(token).toHaveAttribute('placeholder', 'Set · leave empty to keep it')
    await form(page).getByRole('textbox', { name: 'Branch, tag or commit' }).fill('v2')
    await form(page)
      .getByRole('textbox', { name: 'Why', exact: true })
      .fill('Read the released model')
    await noAxeViolations(page)
    await form(page).getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/source=analytics-model$/)
    await expect(sourcePage(page).locator('[data-source-setting="ref"]')).toHaveText('v2')
    await expect(sourcePage(page).locator('[data-source-setting="token"]')).toHaveText('Set')

    // The history log says the token was set, never what it is.
    await sections(page).getByRole('link', { name: 'History log' }).click()
    await expect(page.getByText('Source added').first()).toBeVisible()
    await expect(page.getByText('Source changed').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText(TOKEN)
  })

  test('adds a static list: a form drawn from its manifest, and a test step by step', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=sources&add=true', desktop)
    await page
      .locator('[data-slot="connectors-definitions"]')
      .getByRole('link', { name: 'Static list of definitions' })
      .click()
    await expect(page).toHaveURL(/add=true&connector=static-definitions$/)
    await expect(page).toHaveTitle(
      'Static list of definitions - Add a connector - Sources - Administration - Heed',
    )
    const trail = page.getByRole('navigation', { name: 'breadcrumb' })
    await expect(trail.getByRole('link', { name: 'Add a connector' })).toBeVisible()
    await expect(page.locator('[data-slot="connector-header"]')).toContainText('Experimental')
    await expect(page.locator('[data-slot="source-type"]')).toContainText('Nothing outside the app')
    // Its form is the manifest's: a JSON field, and its domain names under More settings.
    const definitions = form(page).getByRole('textbox', { name: 'Definitions', exact: true })
    await expect(definitions).toBeVisible()
    await expect(form(page).getByRole('button', { name: 'Add a domain name' })).toBeHidden()
    await form(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Finance metrics')
    await definitions.fill('[{"kind": "metric",')
    await form(page).getByRole('button', { name: 'Test connection' }).click()
    await expect(form(page)).toContainText(
      'This is not JSON. Check the brackets, commas and quotes.',
    )
    await expect(definitions).toBeFocused()
    await definitions.fill(
      JSON.stringify([
        { kind: 'metric', name: 'orders.orders', title: 'Orders', domain: 'Finance' },
        { kind: 'dimension', name: 'orders.market', title: 'Market' },
      ]),
    )
    await form(page).getByRole('button', { name: 'Test connection' }).click()
    const steps = check(page).locator('[data-slot="source-check-steps"]')
    await expect(check(page)).toContainText('We can read it')
    await expect(steps.locator('[data-step]')).toHaveText([
      /^Read the list: Done 1 metric and 1 dimension\.$/,
      /^Find each domain: Warning 1 entry names a domain that is not a domain id\./,
    ])
    // A domain name maps the list's name to a domain, and the test says every metric finds it.
    await form(page).getByRole('button', { name: 'More settings' }).click()
    await form(page).getByRole('button', { name: 'Add a domain name' }).click()
    await form(page).getByRole('textbox', { name: "The tool's name, line 1" }).fill('Finance')
    await form(page)
      .getByRole('combobox', { name: 'The domain, line 1' })
      .selectOption({ label: 'Paid media' })
    await form(page).getByRole('button', { name: 'Test connection' }).click()
    await expect(steps.locator('[data-step="domains"]')).toHaveText(
      /^Find each domain: Done Every metric names its domain\.$/,
    )
    await form(page)
      .getByRole('textbox', { name: 'Why', exact: true })
      .fill('Try the platform with a short list')
    await noAxeViolations(page)
    await form(page).getByRole('button', { name: 'Add connector' }).click()
    await expect(page).toHaveURL(/section=sources&source=finance-metrics$/)
    const body = sourcePage(page)
    await expect(body.locator('[data-source-setting="definitions"]')).toHaveText(
      '1 line of JSON. Change settings shows them.',
    )
    await expect(body.locator('[data-source-setting="domainNames"]')).toContainText(
      'Finance→Paid media',
    )
    await noAxeViolations(page)
  })

  test('an unknown connector says so and leads back to the connectors', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=sources&add=true&connector=no-such-tool', desktop)
    await expect(page.locator('[data-slot="connector-not-found"]')).toContainText(
      'No connector has this name',
    )
    await page.getByRole('link', { name: 'Open the connectors' }).click()
    await expect(page).toHaveURL(/section=sources&add=true$/)
  })

  test('an owner is told the form is not theirs', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/admin?section=sources&add=true', desktop)
    await expect(page.locator('[data-slot="source-form"]')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0)
  })
})

test.describe('the ways in', () => {
  test("Operations' definition sources open their page", async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=operations', desktop)
    await page
      .locator('[data-connector="cube"]')
      .getByRole('link', { name: 'Cube local model' })
      .click()
    await expect(page).toHaveURL(/section=sources&source=cube$/)
  })

  test("the catalogue's source line leads an administrator to the source", async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/catalogue', desktop)
    const line = page.locator('[data-slot="source-line"]')
    await expect(line).toContainText('Cube defines them')
    await line.getByRole('link', { name: 'See the source' }).click()
    await expect(page).toHaveURL(/section=sources&source=cube$/)
  })

  test('while the source is down, the warning leads there too', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await scenario(page, 'source-down')
    await openPage(page, '/catalogue', desktop)
    const line = page.locator('[data-slot="source-line"]')
    await expect(line).toContainText("We couldn't read Cube lately")
    await expect(line.getByRole('link', { name: 'See the source' })).toBeVisible()
  })

  test('a contributor reads the line without the way to Sources', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await expect(page.locator('[data-slot="source-line"]')).toContainText('Cube defines them')
    await expect(page.locator('[data-slot="source-link"]')).toHaveCount(0)
  })

  for (const word of ['sources', 'cube', 'integrations'])
    test(`the palette finds Administration by "${word}"`, async ({ page }) => {
      await signInAs(page, 'per_ravi')
      await openPage(page, '/', desktop)
      await page.keyboard.press('Control+k')
      const dialog = page.getByRole('dialog', { name: 'Command palette' })
      await page.keyboard.type(word)
      await expect(dialog.getByRole('option', { name: /^Administration/ })).toBeVisible()
    })
})

test.describe('who may open Sources', () => {
  for (const size of sizes)
    for (const theme of themes)
      test(`an auditor is told whose it is at ${size.name}px, ${theme}`, async ({ page }) => {
        await signInAs(page, 'per_ella')
        await openPage(page, '/admin?section=sources&source=cube', { ...size, theme })
        await expect(page.locator('[data-slot="settings-refused"]')).toContainText(
          'Sources is for admins',
        )
        await expect(page.locator('[data-source], [data-slot="source-page"]')).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
      })

  test('a contributor is not offered Administration at all', async ({ page }) => {
    await openPage(page, '/admin?section=sources', desktop)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
  })
})

test('propose terms puts the metrics without a domain first, says what they need, and gives them one at once', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await scenario(page, 'no-terms')
  await openPage(page, '/admin?section=sources&source=cube&terms=true', desktop)
  const group = page.locator('[data-slot="propose-terms-no-domain"]')
  await expect(group).toContainText('A metric needs one')
  const rows = group.getByRole('list', { name: 'Metrics without a domain' }).getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  const domains = group.getByRole('combobox', { name: /^Domain of / })
  await expect(domains.first()).toHaveValue('')
  await group
    .getByRole('combobox', { name: 'Put every metric without a domain in' })
    .selectOption('area_sales')
  for (const select of await domains.all()) await expect(select).toHaveValue('area_sales')
  const results = await new AxeBuilder({ page }).include('[data-slot="propose-terms"]').analyze()
  expect(results.violations).toEqual([])
})

for (const size of sizes)
  for (const theme of themes)
    test(`Coming soon lists the planned content sources at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await signInAs(page, 'per_ravi')
      await openPage(page, '/admin?section=sources', { ...size, theme })
      const block = page.locator('[data-slot="sources-coming-soon"]')
      await expect(block.getByRole('heading', { level: 2, name: 'Coming soon' })).toBeVisible()
      const items = block.getByRole('list', { name: 'Sources coming soon' }).getByRole('listitem')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('Markdown in a Git repository')
      await expect(items.nth(1)).toContainText('Google Docs')
      await expect(block.locator('[data-slot="coming-soon-kind"]')).toHaveText([
        'Content source',
        'Content source',
      ])
      // Honest: nothing to press, nothing to add, no date.
      await expect(items.getByRole('link')).toHaveCount(0)
      await expect(items.getByRole('button')).toHaveCount(0)
      const request = block.getByRole('link', { name: /Tell us which one you need/ })
      await expect(request).toHaveAttribute(
        'href',
        /^https:\/\/github\.com\/Fredehagelund92\/heed\/issues\/new\?title=/,
      )
      await fits(page, size.width)
      await expect(sourceRow(page, 'cube')).toBeVisible()
    })

test('Add a connector ends with the same planned sources and the way to ask', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=sources&add=true', desktop)
  const note = page.locator('[data-slot="connectors-coming-soon"]')
  await expect(note).toContainText('Markdown in a Git repository, Google Docs')
  await expect(note.getByRole('link', { name: /Tell us which one you need/ })).toBeVisible()
})
