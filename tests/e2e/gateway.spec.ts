import { expect, test, type Page } from '@playwright/test'
import { openPage, widths } from './support'

/*
  MCP and gateway (slice W11a of the front end plan), a section of Administration, on the mock:
  the clients an administrator manages, adding and editing one with a reason, the tool switch with
  its reason, the tabs in the address, the phone list, and what anyone else sees. The mock world lives in the page, so each
  test plays its steps in one page load.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const tablet = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const clientsGrid = (page: Page) => page.getByRole('table', { name: 'Agents' })
const clientRow = (page: Page, label: string) => page.locator(`[data-client="${label}"]`)
const toolRow = (page: Page, tool: string) => page.locator(`[data-tool="${tool}"]`)

test.describe('the clients', () => {
  test('an administrator reads every client with its tools, limits and switch', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await expect(page.getByRole('tab', { name: 'Agents', selected: true })).toBeVisible()
    const rows = clientsGrid(page).getByRole('row')
    await expect(rows).toHaveCount(4)
    // The row governs the tokens that carry its label; Claude Code signed in carries signed-in.
    await expect(clientRow(page, 'claude-code')).toContainText('Claude Code with a token')
    await expect(page.locator('section[aria-labelledby="clients-title"]')).toContainText(
      'Claude Code included, has the label signed-in, so that one row covers them all',
    )
    await expect(clientRow(page, 'claude-code')).toContainText('Every tool that is on')
    await expect(clientRow(page, 'claude-code')).toContainText('Allowed')
    await expect(clientRow(page, 'cursor')).toContainText(
      'Get facts for a question, Search facts, Read a fact',
    )
    await expect(clientRow(page, 'cursor')).toContainText('Default (100 KB)')
    await expect(clientRow(page, 'cursor')).toContainText('Switched off')
    // The steps to connect are on Connect an agent, for everyone.
    await page.getByRole('link', { name: 'Go to Connect an agent' }).click()
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
  })

  test('an administrator adds a client, and its label must be new', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await page.getByRole('button', { name: 'Add an agent' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add an agent' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Support bot')
    await dialog.getByRole('textbox', { name: 'Label' }).fill('claude-code')
    await dialog.getByRole('textbox', { name: 'Why' }).fill('The support team trials an agent')
    await dialog.getByRole('button', { name: 'Add agent' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Label' })).toBeFocused()
    await expect(dialog).toContainText('Another agent has this label.')

    await dialog.getByRole('textbox', { name: 'Label' }).fill('support-bot')
    await dialog.getByRole('radio', { name: 'Only the tools chosen below' }).check()
    await dialog.getByRole('checkbox', { name: 'Get facts for a question' }).check()
    await dialog.getByRole('checkbox', { name: 'Report something missing' }).check()
    await dialog.getByRole('textbox', { name: /Requests a minute/ }).fill('30')
    await dialog.getByRole('button', { name: 'Add agent' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Support bot added')).toBeVisible()
    await expect(clientRow(page, 'support-bot')).toContainText(
      'Get facts for a question, Report something missing',
    )
    await expect(clientRow(page, 'support-bot')).toContainText('30')
    await expect(page.getByRole('button', { name: 'Add an agent' })).toBeFocused()
  })

  test('an administrator switches a client off and changes its answer size', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await page.getByRole('button', { name: 'Edit Evaluation runner' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Evaluation runner' })
    await expect(dialog).toContainText('eval · fixed once an agent is added')
    await dialog.getByRole('checkbox', { name: 'Allowed to connect' }).uncheck()
    await dialog.getByRole('textbox', { name: /Largest answer/ }).fill('500')
    await dialog.getByRole('textbox', { name: 'Why' }).fill('Paused while the runner moves')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByRole('textbox', { name: /Largest answer/ })).toBeFocused()
    await expect(dialog).toContainText('Use 1,000 to 100,000 bytes.')
    await dialog.getByRole('textbox', { name: /Largest answer/ }).fill('50,000')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect(clientRow(page, 'eval')).toContainText('Switched off')
    await expect(clientRow(page, 'eval')).toContainText('50 KB')
    await expect(page.getByRole('button', { name: 'Edit Evaluation runner' })).toBeFocused()
  })

  test('on a phone the clients are a list, and the editor fits the screen', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', phone)
    await expect(clientsGrid(page)).toHaveCount(0)
    const list = page.getByRole('list', { name: 'Agents' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(clientRow(page, 'cursor')).toContainText(
      '60 a minute, answers up to 100 KB (default)',
    )
    await clientRow(page, 'cursor').getByRole('button', { name: 'Edit Cursor' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Cursor' })
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(16)
    expect(box!.x + box!.width).toBeLessThanOrEqual(phone.width - 16)
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width)
  })

  test('a page of 1,024 shows the grid beside the rail', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', tablet)
    await expect(clientsGrid(page)).toBeVisible()
  })
})

test.describe('the tools', () => {
  test('an administrator switches a tool off and on again, each with a reason', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=tools', desktop)
    await expect(page.getByRole('tab', { name: 'Tools', selected: true })).toBeVisible()
    await expect(page.getByText('10 of 12 tools are on.')).toBeVisible()
    await expect(toolRow(page, 'get_related')).toContainText('Off since')
    const getContext = page.getByRole('switch', { name: 'Get facts for a question' })
    await expect(getContext).toBeChecked()

    await getContext.click()
    const off = page.getByRole('alertdialog', { name: 'Switch off Get facts for a question?' })
    await expect(off).toContainText(
      'Claude Code with a token and Evaluation runner stop using it from the next call.',
    )
    // Nothing changes until it is confirmed with a reason (the page behind is inert meanwhile).
    await expect(toolRow(page, 'get_facts').locator('[data-slot="switch"]')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await off.getByRole('button', { name: 'Switch off' }).click()
    await expect(off).toContainText('Give a reason.')
    await off.getByRole('textbox', { name: 'Why' }).fill('Answers cite a retired item')
    await off.getByRole('button', { name: 'Switch off' }).click()
    await expect(off).toBeHidden()
    await expect(getContext).not.toBeChecked()
    await expect(page.getByText('9 of 12 tools are on.')).toBeVisible()
    await expect(page.getByText('Get facts for a question switched off')).toBeVisible()

    await getContext.click()
    const on = page.getByRole('alertdialog', { name: 'Switch on Get facts for a question?' })
    await on.getByRole('textbox', { name: 'Why' }).fill('Fixed')
    await on.getByRole('button', { name: 'Switch on' }).click()
    await expect(on).toBeHidden()
    await expect(getContext).toBeChecked()
  })

  test('cancelling a switch leaves the tool as it was', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=tools', desktop)
    const related = page.getByRole('switch', { name: 'Follow links' })
    await related.click()
    const dialog = page.getByRole('alertdialog', { name: 'Switch on Follow links?' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(related).not.toBeChecked()
  })
})

test.describe('the page', () => {
  test('keeps the tab in the address', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await page.getByRole('tab', { name: 'Activity' }).click()
    await expect(page).toHaveURL(/tab=activity/)
    await expect(page.getByRole('table', { name: 'Calls by agent and tool' })).toBeVisible()
    await page.getByRole('tab', { name: 'Agents' }).click()
    await expect(page).not.toHaveURL(/tab=/)
    await expect(page).toHaveURL(/section=gateway/)
  })

  test('anyone but an administrator is told whose it is', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/admin?section=gateway&tab=tools', desktop)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('switch')).toHaveCount(0)
    // An auditor opens Administration, but not this section of it.
    await signInAs(page, 'per_ella')
    await openPage(page, '/admin?section=gateway&tab=tools', desktop)
    await expect(page.locator('[data-slot="settings-refused"]')).toContainText(
      'MCP and gateway is for admins',
    )
    await expect(page.getByRole('switch')).toHaveCount(0)
  })
})

/*
  The agents people connected (security check F3): every person's connection, found and sorted,
  and disconnected one at a time or all of a person's at once, always with a reason that the
  history log shows. The mock world lives in the page, so the log is read in the same load.
*/
const connectionsGrid = (page: Page) => page.getByRole('table', { name: 'Agents people connected' })
const connectionRow = (page: Page, personId: string, app: string) =>
  page.locator(`[data-person="${personId}"]`).filter({ hasText: app })
const connectionsCount = (page: Page) => page.locator('[data-slot="ai-connections-count"]')

test.describe('the agents people connected', () => {
  test('an administrator finds and sorts every person’s apps', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway', desktop)
    await page.getByRole('tab', { name: 'Connections' }).click()
    await expect(page).toHaveURL(/tab=connections/)
    const rows = connectionsGrid(page).getByRole('rowgroup').nth(1).getByRole('row')
    await expect(rows).toHaveCount(9)
    await expect(connectionsCount(page)).toHaveText('9 agents for 8 people')
    // Last used comes first, the newest at the top.
    const used = page.getByRole('columnheader', { name: /Last used/ })
    await expect(used).toHaveAttribute('aria-sort', 'descending')
    await expect(rows.first()).toContainText('Noor Haddad')
    await expect(rows.first()).toContainText('Claude Code')
    await expect(rows.first()).toContainText('Read, feedback and suggest changes')
    await expect(rows.first()).toContainText('Ends 14 Oct')

    await page.getByRole('button', { name: 'Person' }).click()
    await expect(page.getByRole('columnheader', { name: /Person/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await expect(page).toHaveURL(/sort=person/)
    await expect(rows.first()).toContainText('Jon Abara')
    await page.getByRole('button', { name: 'Person' }).click()
    await expect(page).toHaveURL(/dir=desc/)
    await expect(rows.first()).toContainText('Tomas Eriksen')

    await page.getByRole('searchbox', { name: 'Find a person or an agent' }).fill('claude')
    await expect(page).toHaveURL(/q=claude/)
    await expect(rows).toHaveCount(4)
    await expect(connectionsCount(page)).toHaveText('4 of 9 agents')
    await page.getByRole('searchbox', { name: 'Find a person or an agent' }).fill('nobody here')
    await expect(page.locator('[data-slot="ai-connections-message"]')).toContainText(
      'No agent matches',
    )
    await page.getByRole('button', { name: 'Clear the search' }).click()
    await expect(rows).toHaveCount(9)
    await expect(page.getByRole('searchbox', { name: 'Find a person or an agent' })).toBeFocused()
  })

  test('an administrator disconnects one app with a reason, and the history log keeps it', async ({
    page,
  }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=connections', desktop)
    await page.getByRole('button', { name: 'Disconnect Cursor for Maria Lindqvist' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect Cursor for Maria Lindqvist?' })
    await expect(dialog).toContainText(
      'Cursor stops working for Maria Lindqvist from its next call.',
    )
    // Maria has one app, so there is nothing more to choose.
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    // A reason is required.
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expect(dialog).toContainText('Give a reason.')
    await expect(
      dialog.getByRole('textbox', { name: 'Why are you disconnecting it?' }),
    ).toBeFocused()
    await dialog.getByRole('button', { name: 'Lost or stolen device' }).click()
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Cursor disconnected')).toBeVisible()
    await expect(connectionRow(page, 'per_maria', 'Cursor')).toHaveCount(0)
    await expect(connectionsCount(page)).toHaveText('8 agents for 7 people')
    // Its row went with it, so the focus goes to the search, ready for the next one.
    await expect(page.getByRole('searchbox', { name: 'Find a person or an agent' })).toBeFocused()

    await page.getByRole('link', { name: 'See the history' }).click()
    await expect(page).toHaveURL(/section=audit/)
    await expect(page).toHaveURL(/action=ai_client/)
    const entry = page.getByRole('row').filter({ hasText: 'Agent disconnected' }).first()
    await expect(entry).toContainText('Ravi Kapoor')
    await entry.getByRole('link').first().click()
    await expect(page.locator('[data-slot="audit-entry"]')).toContainText('Lost or stolen device')
    await expect(page.locator('[data-slot="audit-entry"]')).toContainText('disconnected_by_admin')
  })

  test('an administrator disconnects all of one person’s apps in one step', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=connections', desktop)
    await page.getByRole('button', { name: 'Disconnect Claude Code for Jon Abara' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('radio', { name: /All 2 of Jon Abara’s agents/ }).check()
    await expect(dialog.getByRole('heading')).toHaveText('Disconnect all of Jon Abara’s agents?')
    await expect(dialog).toContainText(
      'Claude Desktop and Claude Code stop working for Jon Abara from their next call.',
    )
    await dialog
      .getByRole('textbox', { name: 'Why are you disconnecting them?' })
      .fill('Jon moved to the platform team')
    await dialog.getByRole('button', { name: 'Disconnect 2 agents' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('2 agents disconnected')).toBeVisible()
    await expect(page.locator('[data-person="per_jon"]')).toHaveCount(0)
    await expect(connectionsCount(page)).toHaveText('7 agents for 7 people')
  })

  test('cancelling leaves the app connected', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=connections', desktop)
    await page.getByRole('button', { name: 'Disconnect ChatGPT for Sofia Brandt' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(connectionRow(page, 'per_sofia', 'ChatGPT')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Disconnect ChatGPT for Sofia Brandt' }),
    ).toBeFocused()
  })

  test('on a phone the apps are a list, sorted from a select', async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/admin?section=gateway&tab=connections', phone)
    const list = page.getByRole('list', { name: 'Agents people connected' })
    await expect(list.getByRole('listitem')).toHaveCount(9)
    await expect(connectionsGrid(page)).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Agent, A to Z' })
    await expect(page).toHaveURL(/sort=app/)
    await expect(list.getByRole('listitem').first()).toContainText('ChatGPT')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width)
  })

  test('anyone but an administrator is told whose it is', async ({ page }) => {
    await signInAs(page, 'per_maria')
    await openPage(page, '/admin?section=gateway&tab=connections', desktop)
    await expect(page.getByText('Administration is for admins and auditors')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Disconnect/ })).toHaveCount(0)
    await signInAs(page, 'per_ella')
    await openPage(page, '/admin?section=gateway&tab=connections', desktop)
    await expect(page.locator('[data-slot="settings-refused"]')).toContainText(
      'MCP and gateway is for admins',
    )
    await expect(page.getByRole('button', { name: /^Disconnect/ })).toHaveCount(0)
  })
})
