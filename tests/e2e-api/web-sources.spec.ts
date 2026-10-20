import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/*
  A pasted link becomes a draft (read_source), on the real service with its scripted model
  (MODELS=mock): the person pastes the link of a page and asks for a draft, the service opens the
  page itself, the assistant fills the link, one sentence of the page and the day it was read,
  and the person confirms. The draft opens marked as an external source nobody has reviewed yet.
  The page is served by this test on this machine, which the service may read only because the
  suite sets CL_WEB_READ_LOOPBACK (refused in production).
*/

// An old official page in Portuguese: Windows-1252 and no charset, as some official sites serve it.
const lawPage = Buffer.from(
  `<html><head><title>Regras de devolução</title></head><body>
   <p>Regulamenta a devolução de compras feitas pela internet.</p>
   <p>Art. 1º&nbsp;Ficam os comerciantes obrigados, nos termos da lei, a aceitar a devolução de compras feitas pela internet no prazo de 14 dias.</p></body></html>`,
  'latin1',
)

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.split('?')[0] === '/returns-rules') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(lawPage)
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

async function questionBox(page: Page) {
  await expect(page.locator('[data-slot="ask-composer"]')).toHaveAttribute('data-box', 'chips', {
    timeout: 15_000,
  })
  return page.getByRole('textbox', { name: 'Your question' })
}

type Proposals = {
  rows: { id: string; channel: string; state: string; draft: { evidence?: { url: string }[] } }[]
}

test('a pasted link becomes an unreviewed draft from an external source, with no typing of evidence', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_sofia@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  const link = `${base}/returns-rules?run=${Date.now().toString(36)}`
  await box.fill(`Please draft a context item for Sandbox from this page: ${link}`)
  await box.press('Enter')

  const answer = page.getByRole('article', { name: 'Answer' })
  // The draft waits for the person: its card asks them to create it.
  await expect(answer.getByRole('button', { name: 'Create draft' })).toBeVisible({
    timeout: 30_000,
  })
  // The steps fold once the answer is done; opened, they name the page read.
  const trail = answer.getByRole('button', { name: /^What the assistant did: / })
  if ((await trail.getAttribute('aria-expanded')) !== 'true') await trail.click()
  await expect(answer.getByText('Read 127.0.0.1', { exact: true })).toBeVisible()
  await expect(answer.locator('[data-slot="ask-draft-web"]')).toHaveText(
    'It comes from 127.0.0.1, which the assistant read just now. The owner of its domain checks it before AI apps get it.',
  )
  await answer.getByRole('button', { name: 'Create draft' }).click()
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer.getByText('Saved a draft', { exact: true })).toBeVisible()

  // The draft carries the link, a sentence from the page and the day the service read it.
  const mine = (await (
    await context.request.get('/api/v1/proposals?own=true&state=draft&limit=100')
  ).json()) as Proposals
  const saved = mine.rows.filter((row) => row.draft.evidence?.some((entry) => entry.url === link))
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ channel: 'assistant', state: 'draft' })

  await page.goto(`/library/new?draft=${saved[0]!.id}`)
  const source = page.locator('[data-slot="external-source"]')
  await expect(source).toHaveText(
    'Outside source, not checked yet. The assistant read 127.0.0.1 on 7 Oct 2026 and copied the sentence from it. Open the link and check the sentence before you send it.',
    { timeout: 15_000 },
  )
  // The sentence is on the page: no warning.
  await expect(page.locator('[data-slot="quote-warning"]')).toHaveCount(0)
  const violations = (
    await new AxeBuilder({ page })
      .include('[data-slot="provenance-notice"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((violation) => violation.id)
  expect(violations).toEqual([])
})
