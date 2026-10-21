import { expect, test, type Page } from '@playwright/test'
import { ASK_MATCH, askAndWait, chipEditor } from './ask-support'
import { openPage, settle, themes, widths } from './support'

/*
  Export chat, as a person uses it: off while the chat is empty, then a menu with a line to read
  before sharing, Copy as text and Download as JSON, each with a toast. The export holds the
  questions and the answers, never who asked.
*/

const desktop = { ...widths[0], theme: 'light' } as const
const exportButton = (page: Page) =>
  page.getByRole('button', { name: 'Export chat' }).filter({ visible: true })
/** The parts of the downloaded file this test reads (lib/assistant-export.ts has the whole). */
type Downloaded = {
  title: string
  messages: { role: string; facts?: { status: string | null; domain: string | null }[] }[]
}
const people = ['Maria Lindqvist', 'Jon Abara', 'Sofia Brandt', 'Tomas Eriksen']

async function openChat(
  page: Page,
  size: { width: number; height: number; theme: 'light' | 'dark' },
) {
  await openPage(page, '/assistant', size)
  await chipEditor(page)
}

test('Export chat is off for an empty chat, and on once there is a question', async ({ page }) => {
  await openChat(page, desktop)
  await expect(exportButton(page)).toBeDisabled()
  await askAndWait(page, ASK_MATCH)
  await expect(exportButton(page)).toBeEnabled()
})

test('Copy as text puts the chat on the clipboard, from the keyboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openChat(page, desktop)
  await askAndWait(page, ASK_MATCH)
  await exportButton(page).focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('The export has your questions and the answers.')
  await expect(menu).toContainText('Read it before you share it.')
  await expect(menu.getByRole('menuitem')).toHaveText(['Copy as text', 'Download as JSON'])
  // Opened from the keyboard, the menu starts on its first item.
  await expect(menu.getByRole('menuitem', { name: 'Copy as text' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Chat copied')).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain(`## You`)
  expect(text).toContain(ASK_MATCH)
  expect(text).toContain('## Assistant')
  expect(text).toContain('Facts read:')
  expect(text).toContain('Assistant: scripted-demo (demo data)')
  for (const name of people) expect(text).not.toContain(name)
  expect(text).not.toContain('@')
})

test('Download as JSON saves the chat for debugging', async ({ page }) => {
  await openChat(page, desktop)
  await askAndWait(page, ASK_MATCH)
  await exportButton(page).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download as JSON' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^heed-chat-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
  await expect(page.getByText('Chat downloaded')).toBeVisible()
  const json = await (async () => {
    const stream = await file.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  })()
  const chat = JSON.parse(json) as Downloaded
  expect(chat).toMatchObject({ mode: 'mock', model: 'scripted-demo' })
  expect(chat.title).toBe(ASK_MATCH)
  expect(chat.messages.map((m) => m.role)).toEqual(['you', 'assistant'])
  const facts = chat.messages[1]?.facts ?? []
  expect(facts.length).toBeGreaterThan(0)
  expect(facts[0]).toMatchObject({ status: expect.any(String), domain: expect.any(String) })
  for (const name of people) expect(json).not.toContain(name)
})

test('Export chat is in the panel too', async ({ page }) => {
  await openPage(page, '/', desktop)
  await page.getByRole('button', { name: 'Assistant', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Assistant' })
  await expect(panel.getByRole('button', { name: 'Export chat' })).toBeDisabled()
})

for (const size of [widths[0], widths[2]])
  for (const theme of themes)
    test(`the menu looks right at ${size.name} in ${theme}`, async ({ page }) => {
      await openChat(page, { ...size, theme })
      await askAndWait(page, ASK_MATCH)
      await settle(page)
      await exportButton(page).click()
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await settle(page)
      const box = await menu.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    })
