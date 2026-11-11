import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { legacyManifest, type Manifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from '../server/connectors/object-server.ts'

/*
  What a stranger does with their own semantic manifest (playwright.own-data.config.ts): on an empty
  database, with no demo, connect an invented dbt project through the app, accept the names its
  read made, write a context item that applies to one of its metrics, publish it, and get Checked
  from get_context and from Ask. Every step is the real service on real PostgreSQL; nothing here
  starts from seeded names, which is how this path broke once with every test green.
*/

const mcp = `http://localhost:${process.env.PW_OWN_API_PORT ?? 3121}/mcp`

/** The invented shop's project, with a second metric people call Revenue: a name to look at. */
function ownManifest(): Manifest {
  const file = structuredClone(legacyManifest)
  const revenue = file.metrics.find((metric) => metric.name === 'revenue')!
  file.metrics.push({ ...structuredClone(revenue), name: 'shop_revenue', label: 'Revenue' })
  return file
}

let store: ObjectHost
test.beforeAll(async () => {
  store = await objectHost()
  store.put('/link/semantic_manifest.json', JSON.stringify(ownManifest()))
})
test.afterAll(() => store.close())

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** A write to the service as the signed-in person, as the app makes it. */
async function post(page: Page, path: string, data: object) {
  const { csrfToken } = (await (await page.request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string
  }
  const answer = await page.request.post(`/api/v1${path}`, {
    headers: {
      'x-heed-csrf': csrfToken,
      'idempotency-key': randomUUID(),
      origin: new URL(page.url()).origin,
    },
    data,
  })
  expect(answer.ok(), await answer.text()).toBe(true)
  return answer.json() as Promise<Record<string, unknown>>
}

/** get_context as an agent calls it: over MCP, with an access key. */
async function getContext(page: Page, key: string, args: object) {
  const answer = await page.request.post(mcp, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_context', arguments: args },
    },
  })
  const body = await answer.text()
  const json = body.startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!
  return (JSON.parse(json) as { result: { structuredContent: Record<string, unknown> } }).result
    .structuredContent
}

test('from an own semantic manifest to a Checked answer', async ({ page }) => {
  const shot = (name: string) =>
    process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : null
  await page.goto('/')
  // Not the demo, though people pick who they are: nothing says the company is invented, and the
  // install's label says which install this is, there and in the header after.
  const label = page.locator('[data-profile-label]')
  await expect(page.getByText('Pick who you are.', { exact: true })).toBeVisible()
  await expect(page.getByText(/invented company|This is a demo/)).toHaveCount(0)
  await expect(label).toContainText('Own data trial')
  await shot('05-sign-in')
  await page.getByRole('button', { name: /Ravi Kapoor/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('header').locator(label)).toContainText('Own data trial')

  // The checklist, in the order it can be done: a domain, then the names, then writing.
  await expect(page.getByText('0 of 6 done')).toBeVisible()
  await shot('10-setup')
  const steps = page.getByRole('main').getByRole('listitem')
  await expect(steps.nth(1)).toContainText('Add your first domain')
  await expect(steps.nth(2)).toContainText('Connect your definitions')
  await expect(steps.nth(3)).toContainText('Write your first context item')

  await button(page, 'Add a domain').click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Sales')
  await button(page, 'Add the domain').click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByText('1 of 6 done')).toBeVisible()

  // Connect dbt from the checklist: the fixture's file at an address, through all five steps.
  await button(page, 'Connect').click()
  await page.goto('/settings/integrations/dbt-metricflow/connect?setup=1&step=2')
  await page.getByLabel('File address').fill(store.link('/link/semantic_manifest.json'))
  await button(page, 'Test connection').click()
  await expect(page.getByText('A read would hold 13 metrics and 7 dimensions.')).toBeVisible({
    timeout: 30_000,
  })
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Continue').click()
  await button(page, 'Add dbt').click()
  await expect(page).toHaveURL(/\/inbox$/)

  // The read ends by itself, and its names wait for one press.
  const waiting = page.getByRole('button', { name: /^Publish \d+ names$/ })
  await expect(waiting).toBeVisible({ timeout: 45_000 })
  await shot('11-names-waiting')
  await waiting.click()
  const review = page.getByRole('dialog')
  await expect(review.getByText('Net revenue', { exact: true })).toBeVisible()
  await shot('12-names-review')
  // Two definitions are called Revenue: neither is picked, and Publish all leaves both for a look.
  const flagged = review.getByRole('region', { name: 'Look at these first' })
  await expect(flagged.getByRole('listitem')).toHaveCount(2)
  await expect(flagged.getByRole('listitem').first()).toContainText(
    'Another definition is called “Revenue”',
  )
  await review.getByRole('button', { name: /^Publish all/ }).click()
  await expect(page.getByText('2 of 6 done')).toBeVisible()
  await expect(review.getByRole('button', { name: /^Publish all/ })).toBeHidden()
  await shot('12-names-flagged')
  // The owner gives one a word of its own, and the other has nothing against it any more.
  const second = flagged.getByRole('listitem').nth(1)
  await second.getByRole('textbox').fill('Shop revenue')
  await second.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(flagged).toBeHidden()
  await review.getByRole('button', { name: /^Publish all/ }).click()
  await expect(review).toBeHidden()
  await expect(page.getByRole('button', { name: /^Publish \d+ names?$/ })).toBeHidden()

  // The vocabulary is live: Definitions lists the metric, and it has its domain.
  await page.goto('/definitions')
  await expect(page.getByRole('row', { name: /^Select Net revenue/ })).toBeVisible()
  await shot('13-definitions')

  // A context item that applies to the synced metric, published in one step by its owner.
  await page.goto('/context/new')
  await page
    .getByRole('textbox', { name: 'Title' })
    .fill('Net revenue left out returns before March')
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(
    'Net revenue left out returns until 1 March 2026, so earlier months read high.',
  )
  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Net revenue')
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name: /^Net revenue/ })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://finance.example/returns-change')
  await page.locator('#fact-quote').fill('Returns are part of net revenue from 1 March 2026 on.')
  await page.keyboard.press('Escape')
  await shot('14-editor')
  await button(page, 'Publish').click()
  await expect(page.getByText(/^Published just now by you/)).toBeVisible()

  // An agent asks over MCP, as a key that names nobody.
  const { key } = await post(page, '/access-keys', { name: 'Own data journey' })
  const reply = await getContext(page, key as string, {
    question: 'What should I know about Net revenue today?',
  })
  expect(reply).toMatchObject({ status: 'matched' })
  expect(reply.say).toMatch(/^Checked\./)
  expect(JSON.stringify(reply)).toContain('Net revenue left out returns before March')

  // And a person asks in Ask.
  await page.goto('/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await page.keyboard.insertText('What should I know about Net revenue today?')
  await box.press('Enter')
  await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await shot('15-ask')
})
