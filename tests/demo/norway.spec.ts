import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, test, type Page } from '@playwright/test'
import { devKey, mintDevToken } from '../../src/server/mcp/auth.ts'
import { norwayShow } from '../../db/seed/norway.ts'

/*
  The Norway show, step by step, as docs/demo.md tells the presenter to run it: the daily
  check (`npm run demo:check`, scripts/demo.ts) runs it headlessly on a fresh show database
  before every rehearsal and fails loudly at the first step that breaks. Every step a person
  takes goes through the browser, as the presenter takes it; what Claude does goes through the
  MCP wire with the same question Claude Code asks, which is what Claude reads.

    1. Maria asks Try it about orders in Norway in October 2026: nothing applies.
    2. Claude, asked the same, is told Heed has nothing written down.
    3. Maria starts a draft from Try it, writes the stop and submits it; the checks run.
    4. Jon, the owner of Sales, accepts it, and a new edition goes live.
    5. Try it and Claude now get the fact, with its source and the reviewed line.
    6. Ravi, the administrator, stops delivery of the item; within a minute Claude no longer
       gets it.
    7. Claude, asked about Spain, is told Heed has nothing written down.

  With DEMO_SCREENSHOTS set to a folder, it saves the screen of each step there, which is how
  the pictures in docs/demo are made (scripts/demo.ts check --screenshots).
*/

test.describe.configure({ timeout: 300_000 })

const apiUrl = `http://127.0.0.1:${process.env.PW_DEMO_API_PORT ?? 3310}`
const shots = process.env.DEMO_SCREENSHOTS

/** What Maria writes, word for word as docs/demo.md has the presenter type it. */
export const fact = {
  title: 'Online sales to Norway stopped on 4 August 2026',
  summary:
    'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
  from: '4 Aug 2026',
  link: 'https://customs.example/norway/notices/2026-08-04',
  quote:
    'Parcels from webshops outside Norway are held at the border from 4 August 2026 until further notice.',
  notToConclude: 'Fewer orders in Norway after 4 August do not mean fewer customers.',
  reason: 'Matches the customs notice.',
  stop: 'Show: taking the stop back out of delivery.',
}

type Served = {
  status: string
  say: string
  edition: string
  items?: ({ id: string; title: string; evidence?: { url: string; quote: string }[] } & Record<
    string,
    unknown
  >)[]
}

/** What Claude Code reads when it asks Heed the question, through the MCP wire. */
async function claudeAsks(question: string): Promise<Served> {
  // The service checks tokens against the dev key it keeps beside it (docs/reference.md, "Connect Claude Code to Heed").
  const key = await devKey(process.env.MCP_DEV_KEY_FILE ?? '.heed-dev-key.pem', 'test')
  const token = await mintDevToken(key, apiUrl.replace('127.0.0.1', 'localhost') + '/mcp')
  const wire = new Client(
    { name: 'norway-show', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  try {
    const reply = await wire.callTool({ name: 'get_facts', arguments: { question } })
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true)
    return reply.structuredContent as Served
  } finally {
    await wire.close()
  }
}

/** Signs in from the sign-in page, as the presenter does on a fresh browser. */
async function signInAs(page: Page, name: string) {
  await page.goto('/signed-out')
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  await page.getByRole('option', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: `Continue as ${name}` }).click()
  await expect(
    page.locator('[data-slot="sidebar"]').getByRole('button', { name: new RegExp(name) }),
  ).toBeVisible({ timeout: 30_000 })
}

/** Switch demo person, in the menu under the name of whoever is signed in. */
async function switchTo(page: Page, from: string, to: string) {
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole('button', { name: new RegExp(from) })
    .click()
  await page.getByRole('menuitem', { name: 'Switch demo person' }).click()
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  await page.getByRole('option', { name: new RegExp(to) }).click()
  await page.getByRole('button', { name: `Continue as ${to}` }).click()
  await expect(
    page.locator('[data-slot="sidebar"]').getByRole('button', { name: new RegExp(to) }),
  ).toBeVisible({ timeout: 30_000 })
}

/** Adds a term to a scope picker by typing its name and choosing it. */
async function choose(page: Page, field: string, words: string) {
  const picker = page.getByRole('combobox', { name: field })
  await picker.fill(words)
  await page
    .getByRole('option', { name: new RegExp(`^${words}`) })
    .first()
    .click()
}

async function shoot(page: Page, name: string) {
  if (!shots) return
  // A picture shows the loaded page, not a placeholder, toast or focus ring left over it.
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0, { timeout: 15_000 })
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) active.blur()
  })
  await page.screenshot({ path: `${shots}/${name}.png` })
}

const tryIt = (market: string) =>
  `/try-it?about=metric:orders,val:market/${market}&from=2026-10-01&to=2026-10-31`

test('the Norway show runs from nothing to an answer, a stop and an honest nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await test.step('1. Try it finds nothing for orders in Norway', async () => {
    await signInAs(page, 'Maria Lindqvist')
    await page.goto('/')
    await page.getByRole('link', { name: /Try a question/ }).click()
    await choose(page, 'What it is about', 'Orders')
    await choose(page, 'What it is about', 'Norway')
    for (const [field, day] of [
      ['From', '1 Oct 2026'],
      ['To', '31 Oct 2026'],
    ] as const) {
      const box = page.getByRole('textbox', { name: field })
      await box.fill(day)
      await box.press('Tab')
    }
    await page.getByRole('button', { name: 'Show what agents get' }).click()
    const reply = page.getByRole('region', { name: 'What agents get' })
    await expect(reply.locator('[data-slot="try-it-no-match"]')).toBeVisible({ timeout: 30_000 })
    await expect(reply).toContainText('Nothing is written down for this')
    await expect(page).toHaveURL(/about=metric(%3A|:)orders/)
    await shoot(page, '01-try-it-nothing')
  })

  await test.step('2. Claude is told nothing is written down for Norway', async () => {
    const served = await claudeAsks(norwayShow.questions.norway)
    expect(served.status, served.say).toBe('no_match')
    expect(served.say).toContain('Nothing is written down for Orders in Norway')
  })

  let proposal = ''
  await test.step('3. Maria writes the stop from Try it and submits it; the checks run', async () => {
    await page
      .getByRole('region', { name: 'What agents get' })
      .getByRole('link', { name: 'Start a draft' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a fact' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('combobox', { name: 'Kind' })).toHaveText(/Event/)
    const where = page.getByRole('region', { name: 'Where it applies' })
    await expect(where.getByRole('list', { name: 'Chosen' })).toContainText('Orders')
    await expect(where.getByRole('list', { name: 'Chosen' })).toContainText('Norway')
    await page.getByRole('textbox', { name: 'Title' }).fill(fact.title)
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill(fact.summary)
    const from = page.getByRole('region', { name: 'When it applies' }).getByRole('textbox', {
      name: 'From',
    })
    await from.fill(fact.from)
    await from.press('Tab')
    await page.getByRole('textbox', { name: 'Link to the source' }).fill(fact.link)
    await page.getByRole('textbox', { name: 'A sentence copied from the source' }).fill(fact.quote)
    await page.getByRole('button', { name: 'Date you read it: today' }).click()
    await page.getByRole('textbox', { name: 'What not to conclude' }).fill(fact.notToConclude)
    await page.evaluate(() => window.scrollTo(0, 0))
    await shoot(page, '02-maria-writes')
    await page
      .getByRole('button', { name: 'Send for review', exact: true })
      .filter({ visible: true })
      .click()
    await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    proposal = /\/proposals\/([0-9a-f-]{36})$/.exec(page.url())![1]!
    await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')
    await expect(page.getByRole('list', { name: 'Checks' })).toBeVisible({ timeout: 30_000 })
    await shoot(page, '03-checks')
  })

  let edition = ''
  await test.step('4. Jon, the owner of Sales, accepts it', async () => {
    // Switch demo person comes back to the page it left: the proposal, now as its reviewer.
    await switchTo(page, 'Maria Lindqvist', 'Jon Abara')
    await expect(page).toHaveURL(new RegExp(`/proposals/${proposal}$`))
    await expect(page.getByRole('heading', { level: 1, name: fact.title })).toBeVisible({
      timeout: 15_000,
    })
    const bar = page.getByRole('region', { name: 'Your decision' })
    await expect(bar).toContainText('as owner of Sales')
    await bar.getByRole('button', { name: 'Accept', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
    await dialog.getByRole('textbox', { name: 'Why are you accepting it?' }).fill(fact.reason)
    await dialog.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByText('From then on, agents get it.').first()).toBeVisible({
      timeout: 30_000,
    })
    await shoot(page, '04-jon-accepts')
  })

  let item = ''
  await test.step('5. Try it and Claude get the fact, its source and the reviewed line', async () => {
    await switchTo(page, 'Jon Abara', 'Maria Lindqvist')
    await page.goto(tryIt('norway'))
    const delivered = page.getByRole('list', { name: 'What the agent gets, in order' })
    await expect(delivered).toContainText(fact.title, { timeout: 30_000 })
    await shoot(page, '05-try-it-fact')

    const served = await claudeAsks(norwayShow.questions.norway)
    expect(served.status, served.say).toBe('matched')
    // The proposal page names no edition; the accepted fact in the reply proves it is the new one.
    expect(served.edition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    edition = served.edition
    const stop = served.items?.find((candidate) => candidate.title === fact.title)
    expect(stop, JSON.stringify(served.items?.map((i) => i.title))).toBeTruthy()
    item = stop!.id
    expect(stop!.evidence?.map((source) => source.url)).toContain(fact.link)
    expect(JSON.stringify(stop)).toContain(fact.notToConclude)
    const text = JSON.stringify(stop)
    expect(text).toMatch(/owner of Sales/)
    expect(text).toContain(edition)
    // What an agent receives names the role, never the person (FR-326 as amended).
    expect(text).not.toContain('Jon Abara')
  })

  await test.step('6. Ravi stops delivery of the item; within a minute Claude no longer gets it', async () => {
    await switchTo(page, 'Maria Lindqvist', 'Ravi Kapoor')
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Editions' })
      .click()
    const card = page.locator('[data-slot="live-edition"]')
    await card.getByRole('button', { name: 'More actions for this edition' }).click({
      timeout: 15_000,
    })
    await page.getByRole('menuitem', { name: 'Stop sharing…' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Stop sharing with agents?' })
    await dialog.getByRole('radio', { name: 'One fact' }).click()
    await dialog
      .getByRole('combobox', { name: /fact/i })
      .fill('Online sales to Norway stopped on 4')
    await page.getByRole('option', { name: fact.title }).click()
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await dialog.getByRole('textbox', { name: 'Why are you stopping it?' }).fill(fact.stop)
    await shoot(page, '06-stop-delivery')
    const stopped = Date.now()
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(page.getByRole('alertdialog', { name: /^Stopped for / })).toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(
        async () => ((await claudeAsks(norwayShow.questions.norway)).items ?? []).map((i) => i.id),
        { timeout: 60_000, intervals: [2_000] },
      )
      .not.toContain(item)
    console.log(
      `Claude stopped getting the item ${Math.round((Date.now() - stopped) / 1000)} s after the stop`,
    )
  })

  await test.step('7. Claude is told nothing is written down for Spain', async () => {
    const served = await claudeAsks(norwayShow.questions.spain)
    expect(served.status, served.say).toBe('no_match')
    expect(served.say).toContain('Nothing is written down for Orders in Spain')
    await page.goto(tryIt('spain'))
    await expect(
      page
        .getByRole('region', { name: 'What agents get' })
        .locator('[data-slot="try-it-no-match"]'),
    ).toBeVisible({ timeout: 30_000 })
    await shoot(page, '07-spain-nothing')
  })
})
