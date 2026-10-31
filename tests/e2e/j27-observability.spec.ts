import {
  beforeLastPublish,
  card,
  cardIn,
  domainId,
  expect,
  go,
  mode,
  onMockOnly,
  signInAs,
  test,
  topicId,
} from './go.ts'

// J27: Observability, what agents asked and what they got. One row at the sidebar's foot for admins
// and owners, between Help and Settings; it swaps the sidebar to its own menu, as Settings does.

/** The reports Feedback lists this week: on the service, only what agents sent (named ones: P10). */
const reports = () => (mode === 'http' ? 6 : 9)
/** Tool calls in the last 30 days: the mock scales its week, the service counts its weeks. */
const toolCalls30 = () => (mode === 'http' ? '1,330' : '1,342')

test('the row sits between Help and Settings and swaps the sidebar to its own menu', async ({
  page,
}) => {
  await go(page, '/inbox')
  const sidebar = page.locator('[data-sidebar=sidebar]').first()
  await expect(sidebar.getByRole('link', { name: 'Observability' })).toBeVisible()
  const foot = await sidebar.locator('[data-slot=sidebar-menu-item]').allInnerTexts()
  const at = foot.findIndex((t) => t.trim() === 'Observability')
  expect(foot[at - 1]?.trim()).toBe('Help')
  expect(foot[at + 1]?.trim()).toBe('Settings')
  await sidebar.getByRole('link', { name: 'Observability' }).click()
  await expect(page).toHaveURL(/\/observability/)
  for (const name of [
    'Back to app',
    'Summary',
    'Overview',
    'Questions',
    'Quality',
    'Feedback',
    'Usage',
    'Alerts',
  ])
    await expect(sidebar.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
  // Quality's badge counts what needs a look, from the saved questions.
  await expect(sidebar.getByRole('link', { name: /^Quality/ }).locator('..')).toContainText('2')
  await sidebar.getByRole('link', { name: 'Back to app' }).click()
  await expect(page).toHaveURL(/\/inbox/)
})

test('owners see it for their domains without Usage; someone who only suggests has no row', async ({
  page,
}) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability')
  const sidebar = page.locator('[data-sidebar=sidebar]').first()
  await expect(sidebar.getByRole('link', { name: /^Overview/ })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: /^Usage/ })).toHaveCount(0)
  await go(page, '/observability/usage')
  await expect(page.getByText('Usage is for admins')).toBeVisible()

  await signInAs(page, 'Ines Duarte')
  await go(page, '/inbox')
  await expect(
    page.locator('[data-sidebar=sidebar]').first().getByRole('link', { name: 'Observability' }),
  ).toHaveCount(0)
  await go(page, '/observability')
  await expect(page.getByText('Observability is for owners and admins')).toBeVisible()
})

test("Overview: the Inbox's own numbers, a way into each, and the range and filters in the address", async ({
  page,
}) => {
  await go(page, '/observability/overview')
  const cells = page.locator('a', { hasText: 'Asked' }).first()
  await expect(cells).toContainText('142')
  // 142 against 129 the 7 days before is a move chance would make: no arrow, no colour, no per cent.
  await expect(cells).toContainText('About the same')
  await expect(cells).not.toContainText('%')
  // The checked share counts Checked answers only: 94 of 142, not the 117 that found something.
  const checked = page.getByRole('link', { name: /^Checked answers/ })
  await expect(checked).toContainText('66%')
  await expect(checked).toContainText('94 of 142 asked')
  await expect(checked).toHaveAttribute('href', /answer=grounded/)
  const nothing = page.getByRole('link', { name: /^Not found/ })
  await expect(nothing).toContainText('About the same')
  await expect(nothing.locator('[data-slot=kpi-change] svg')).toHaveCount(0)
  // One source for saved questions: 9 same of 12.
  await expect(page.getByRole('link', { name: /Saved questions/ })).toContainText(
    /9\s*same\s*of 12/,
  )
  // The chart's numbers, for a screen reader.
  await expect(page.locator('table caption', { hasText: 'Questions per day' })).toHaveCount(1)
  // What found nothing goes to the Inbox, where its draft or suggestion waits.
  await expect(page.getByRole('link', { name: 'Draft ready' })).toHaveAttribute(
    'href',
    `/inbox?card=${card('gap-spain')}`,
  )

  await page.getByRole('radio', { name: '30 days' }).click()
  await expect(page).toHaveURL(/range=30/)
  await expect(page.getByRole('heading', { name: 'Questions per day' })).toBeVisible()
  // A publish in the range is marked on its day.
  await expect(
    page
      .locator('table')
      .filter({ hasText: 'Questions per day' })
      .getByRole('rowheader', { name: /published/ })
      .first(),
  ).toBeVisible()
  // Labels over the chart never run into each other: one that has no room is left out.
  const labels = await page
    .locator('figure svg text', { hasText: /published/i })
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]))
  for (const [i, [, right]] of labels.entries())
    if (labels[i + 1]) expect(right!).toBeLessThan(labels[i + 1]![0]!)
  await page.getByRole('radio', { name: '90 days' }).click()
  await expect(page.getByRole('heading', { name: 'Questions per week' })).toBeVisible()
  // 90 days against the 90 before: more checked, by more than chance would make, is good news.
  const up = page.getByRole('link', { name: /^Checked answers/ }).locator('[data-slot=kpi-change]')
  await expect(up).toContainText(/\+\d+ pts/)
  await expect(up.locator('svg')).toHaveCount(1)
  await expect(up).toHaveClass(/text-good-ink/)

  // A number is a way into its rows.
  await page.getByRole('link', { name: /^Not found/ }).click()
  await expect(page).toHaveURL(/observability\/questions.*answer=missing/)
})

test("Overview: nothing connected, too few to show, and an owner's own domain", async ({
  page,
}) => {
  await go(page, '/observability/overview?state=empty')
  await expect(page.getByRole('heading', { name: 'No agent has asked anything yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect an agent' })).toBeVisible()
  await onMockOnly('review flag for too few questions', async () => {
    await go(page, '/observability/overview?state=quiet')
    await expect(page.getByText('Too few questions to show')).toBeVisible()
    await expect(page.getByText('Fewer than 5').first()).toBeVisible()
  })

  await go(page, '/observability?demo=week')
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability/overview')
  await expect(page.getByText('What agents asked about Marketing this week')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Asked/ })).toContainText('24')
  await expect(page.getByRole('heading', { name: 'By agent' })).toHaveCount(0)
  await expect(page.getByText('You see the domains you own.')).toBeVisible()
})

test('Questions: saved views, a filter that reads as a sentence, and a view saved for everyone', async ({
  page,
}) => {
  await go(page, '/observability/questions')
  const views = page.getByRole('tablist', { name: 'Saved views' })
  // Views count exact topics (16); the table groups them by metric and market, so Germany's two months are one row.
  await expect(views.getByRole('tab', { name: /^All topics 16/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await views.getByRole('tab', { name: /^Not found 4/ }).click()
  await expect(page.locator('tbody [data-row-open]')).toHaveCount(3)
  await views.getByRole('tab', { name: /^All topics/ }).click()

  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitem', { name: 'Answer' }).hover()
  await page.getByRole('menuitemcheckbox', { name: /Not found/ }).click()
  // The submenu, then the menu.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByText('Answer is Not found')).toBeVisible()
  await expect(page).toHaveURL(/answer=missing/)

  await page.getByRole('button', { name: 'Save this view' }).click()
  await page.getByLabel('Name the view').fill('Found nothing')
  await page.getByRole('button', { name: 'Save for everyone' }).click()
  await expect(views.getByRole('tab', { name: /^Found nothing/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('Everyone in the workspace has it as a tab.')).toBeVisible()
})

test('The answer panel replays a topic: what an agent gets, the steps, and what to look at', async ({
  page,
}) => {
  await go(page, '/observability/questions')
  await page.locator('tbody [data-row-open]', { hasText: 'Orders in Spain' }).click()
  const panel = page.locator('[data-slot=resizable-panel]').last()
  await expect(panel.getByRole('heading', { name: 'Orders in Spain, October 2026' })).toBeVisible()
  await expect(panel.getByText('What an agent gets now')).toBeVisible()
  await panel.getByRole('tab', { name: 'Steps' }).click()
  await expect(panel.getByText('This is a replay')).toBeVisible()
  for (const step of [
    'Read the scope',
    'Looked for context',
    'Left out',
    'Checked',
    'Said',
    'Told the agent what to do next',
    'After the answer',
  ])
    await expect(panel.getByText(step, { exact: true })).toBeVisible()
  await expect(
    panel.getByText('0 context items apply to Orders in Spain in October 2026.'),
  ).toBeVisible()
  await panel.getByRole('tab', { name: /Warnings/ }).click()
  await expect(panel.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    `/inbox?card=${card('gap-spain')}`,
  )
  // The way forward: the draft, Ask with the question, and saving it.
  await expect(panel.getByRole('link', { name: 'Write context for this' })).toHaveAttribute(
    'href',
    `/inbox?card=${card('gap-spain')}`,
  )
  await expect(panel.getByRole('link', { name: 'Try it' })).toHaveAttribute('href', /\/ask\?q=/)
  // J moves to the next topic, as in every peek: the row under it in the table.
  await panel.getByRole('tab', { name: 'Overview' }).click()
  const order = await page.locator('tbody [data-row-open]').allInnerTexts()
  const next = order[order.findIndex((t) => t.startsWith('Orders in Spain')) + 1]!
  await page.keyboard.press('j')
  await expect(
    panel.getByRole('heading', { name: new RegExp(`^${next.split('\n')[0]!.split(',')[0]}`) }),
  ).toBeVisible()
})

test('The replay runs on what agents got before the last publish', async ({ page }) => {
  await go(page, '/observability/questions')
  await go(page, `/observability/questions?dock=topic.${topicId('units-sold-all')}`)
  const panel = page.locator('[data-slot=resizable-panel]').last()
  const before = beforeLastPublish()
  await panel
    .getByRole('button', { name: `Compare with what agents got ${before.toLowerCase()}` })
    .click()
  // Side by side when the publish changed what it reads, else said to be the same.
  await expect(
    panel.getByText(before, { exact: true }).or(panel.getByText(/^The same before/)),
  ).toBeVisible()
  await panel.getByRole('tab', { name: 'Steps' }).click()
  await panel.getByRole('radio', { name: before }).click()
  await expect(page).toHaveURL(/when=before/)
})

test('Quality: the one list, grouped by result, with before and now and Keep the new answer', async ({
  page,
}) => {
  await go(page, '/observability/quality')
  for (const [name, n] of [
    ['Needs a look', '2'],
    ['Changed', '1'],
    ['Same', '9'],
  ] as const)
    await expect(page.getByRole('region', { name }).getByRole('heading')).toContainText(n)
  const look = page.getByRole('region', { name: 'Needs a look' })
  // Needs a look leads with Open the item; Changed with Keep the new answer.
  await expect(
    look.getByRole('listitem').first().getByRole('link', { name: 'Open the item' }),
  ).toHaveAttribute('href', '/context/itm_kh4llvi9')
  const changed = page.getByRole('region', { name: 'Changed' })
  await changed.getByRole('button', { name: 'Keep the new answer' }).click()
  await expect(page.getByText('The new answer is its saved one')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Changed' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('region', { name: 'Changed' })).toHaveCount(1)
  // Check now runs, publishes nothing, and says so. The service checks twelve questions at once:
  // its answer comes slowly here, so the line that waits on it can be read.
  if (mode === 'http')
    await page.route('**/api/v1/saved-questions/check', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
  await page.getByRole('button', { name: 'Check now' }).click()
  await expect(
    page.getByText(/Checking \d+ saved questions\. Nothing is published\./),
  ).toBeVisible()
  await expect(page.getByText(/^Checked \d+ saved questions$/)).toBeVisible({ timeout: 8000 })
})

test('Quality: no saved questions yet, a failed check, and offline', async ({ page }) => {
  await go(page, '/observability/quality?state=empty')
  await expect(page.getByText('No saved questions yet')).toBeVisible()
  await go(page, '/observability/quality?demo=week&quality=failed')
  await expect(page.getByRole('alert')).toContainText(
    'The check did not finish. It stopped after 8 of 12 questions. Nothing was changed',
  )
  await go(page, '/observability/quality?state=offline')
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('Saved questions are saved from Ask, counted everywhere from one list, and checked in the review', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('Why did orders in Norway drop in August?')
  await box.press('Enter')
  await page.getByRole('button', { name: 'Save question' }).first().click()
  await expect(page.getByText('Should answer from')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText('Question saved')).toBeVisible()
  // One list: Quality, the domain's health line and the Overview cell all count 13 now.
  await go(page, '/observability/quality')
  await expect(
    page
      .getByRole('link', { name: /Saved questions/ })
      .or(page.getByText('Saved questions').first()),
  ).toBeVisible()
  await expect(
    page.locator('div', { hasText: /^Saved questions13in 4 domains$/ }).first(),
  ).toBeVisible()
  await go(page, '/settings/domains/sales')
  await expect(
    page.getByRole('link', { name: /8 saved questions - 5 same - 1 changed - 2 need a look/ }),
  ).toHaveAttribute('href', `/observability/quality?domain=${domainId('sales')}`)
  await go(page, '/observability/overview')
  await expect(page.getByRole('link', { name: /Saved questions/ })).toContainText(
    /10\s*same\s*of 13/,
  )

  // The review says what a draft would do to the saved questions that answer from its item.
  await go(page, '/inbox/sug-ines/review')
  await expect(page.getByText('0 of 1 still answers the same. 1 changed.')).toBeVisible()
  await page.getByRole('button', { name: /Do units sold include test accounts\?/ }).click()
  await expect(page.locator('ins').filter({ hasText: '340' }).first()).toBeVisible()
  await go(page, '/inbox/gap-spain/review')
  await expect(page.getByRole('checkbox', { name: /Also save this question/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test("Feedback: what was said about answers, reports by state, and nobody's name on an agent's", async ({
  page,
}) => {
  await go(page, '/observability/feedback')
  await expect(page.getByText('Something was wrong').locator('..').locator('..')).toContainText(
    'Fewer than 5',
  )
  const tabs = page.getByRole('tablist', { name: 'Reports' })
  await expect(tabs.getByRole('tab', { name: new RegExp(`^All ${reports()}`) })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await tabs.getByRole('tab', { name: /^In the Inbox 1/ }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await expect(
    panel.getByRole('link', { name: 'Orders lags by one day in the source tool' }),
  ).toHaveAttribute('href', `/inbox?card=${card('flag-germany')}`)
  await tabs.getByRole('tab', { name: /^All/ }).click()
  // An agent's report carries its kind, never a person's name.
  await expect(
    panel.getByRole('listitem').filter({ hasText: 'From an agent' }).first(),
  ).toContainText('Claude Code')
  await expect(page.getByText('Agents never read them.')).toBeVisible()
  await go(page, '/observability/feedback?state=empty')
  await expect(page.getByText('Nothing said about answers yet')).toBeVisible()
})

test('Usage: tools with their results, agents by kind, and spend against the caps', async ({
  page,
}) => {
  await go(page, '/observability/usage')
  await expect(page.getByText('Tool calls').locator('..').locator('..')).toContainText('312')
  const tools = page.getByRole('table', { name: 'Calls by tool' })
  await expect(tools.getByRole('row').filter({ hasText: 'get_context' })).toContainText('142')
  await expect(tools.getByRole('row').filter({ hasText: 'suggest_context' })).toContainText('2')
  const agents = page.getByRole('table', { name: 'Calls by kind of agent' })
  await expect(agents.getByRole('row')).toHaveCount(6)
  await expect(
    page
      .getByRole('table', { name: 'Spend caps' })
      .getByRole('row')
      .filter({ hasText: 'Each month, all model use' }),
  ).toContainText('$50.00')
  await expect(page.getByRole('link', { name: 'Limits' })).toHaveAttribute(
    'href',
    '/settings/advanced',
  )
  // A longer range counts more calls; the spend stays this month's.
  await page.getByRole('radio', { name: '30 days' }).click()
  await expect(page).toHaveURL(/range=30/)
  await expect(page.getByText('Tool calls').locator('..').locator('..')).toContainText(
    toolCalls30(),
  )
  await go(page, '/observability/usage?state=empty')
  await expect(page.getByText('No agent has called yet')).toBeVisible()
})

test('Limits: every tuning setting, read only, with where its value comes from', async ({
  page,
}) => {
  await go(page, '/observability/usage')
  await page.getByRole('link', { name: 'Limits' }).click()
  await expect(page).toHaveURL(/\/settings\/advanced$/)
  await expect(
    page.getByText('All 32 settings and their values now. This page only shows them.'),
  ).toBeVisible()
  // The page says how a setting is really changed, and names no command that does not exist.
  await expect(page.getByText('PUT /api/v1/settings/{key}')).toBeVisible()
  await expect(page.getByText(/settings set/)).toHaveCount(0)
  const settings = page.getByRole('table', { name: 'Tuning settings' })
  // A header for each of the 7 groups, and one for each of the 32 settings.
  await expect(settings.getByRole('rowheader')).toHaveCount(7 + 32)
  await expect(settings.getByRole('rowheader', { name: 'Model spend', exact: true })).toBeVisible()
  // The cap Usage reads was changed after the install; the privacy minimum keeps its default.
  await expect(settings.getByRole('row', { name: /limits\.llm_monthly_cap_micros/ })).toContainText(
    /\$50\s*Changed/,
  )
  await expect(settings.getByRole('row', { name: /privacy\.min_count/ })).toContainText(
    /5\s*Default\s*Install/,
  )
  // Read only: nothing in the table changes a value.
  await expect(settings.getByRole('button')).toHaveCount(0)
  await expect(settings.getByRole('textbox')).toHaveCount(0)
})

test('Alerts: rules as sentences that raise Inbox cards, thresholds for admins, mute for owners', async ({
  page,
}) => {
  await go(page, '/observability/alerts')
  await expect(page.getByRole('switch')).toHaveCount(8)
  await expect(
    page.getByText('After a publish, an archive, a restore, a sync, or a check date passing'),
  ).toBeVisible()
  // Your own rules are not built yet: the button says so, looks off, and the reason is text.
  const add = page.getByRole('button', { name: 'Add a rule Coming soon' })
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveCSS('opacity', '0.5')
  await expect(add).toHaveAccessibleDescription(
    'The eight rules are fixed for now. Your own rules, and email and chat, come later.',
  )
  await expect(
    page.getByText('The eight rules are fixed for now. Your own rules, and email and chat'),
  ).toBeVisible()
  // An admin changes a threshold inside the sentence.
  await page.getByRole('combobox', { name: 'Not found: threshold', exact: true }).click()
  await page.getByRole('option', { name: '10' }).click()
  await expect(page.getByText('Threshold changed')).toBeVisible()
  await page.getByRole('switch', { name: 'Model spend' }).click()
  await expect(page.getByText('Turned off: Model spend')).toBeVisible()
  // The saved-question alert is a card in the Inbox, and the card opens Quality on its domain.
  await page.getByRole('link', { name: '2 saved questions need a look' }).click()
  await expect(page).toHaveURL(new RegExp(`/inbox\\?card=${cardIn('look-sales')}`))
  await expect(
    page.getByText('Why did support contacts in Norway rise in autumn 2025?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open in Quality' }).click()
  await expect(page).toHaveURL(new RegExp(`/observability/quality\\?domain=${domainId('sales')}`))
  // A rule with a card of its own raises an Alert card, with one action to where the rule points:
  // the mock's Conflict about Net revenue, the demo week's source that has not synced yet.
  const alert =
    mode === 'http'
      ? {
          title: /did not sync$/,
          rule: 'A connected tool did not sync',
          open: 'Open the integration',
          to: /\/settings\/integrations\//,
        }
      : {
          title: 'Net revenue in Norway: conflict, 3 times',
          rule: 'Conflict',
          open: 'Open the topic',
          to: /\/observability\/questions\?dock=topic\./,
        }
  await go(page, '/observability/alerts')
  await page.getByRole('link', { name: alert.title }).first().click()
  await expect(page).toHaveURL(/\/inbox\?card=alert/)
  await expect(page.getByText(`From the alert rule ${alert.rule}.`)).toBeVisible()
  await page.getByRole('button', { name: alert.open }).click()
  await expect(page).toHaveURL(alert.to)

  // An owner sees the rules that reach owners, mutes one for their domain, and sees only their own raises.
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability/alerts')
  await expect(page.getByRole('switch')).toHaveCount(5)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await page.getByRole('switch', { name: 'A check is due, for Marketing' }).click()
  await expect(page.getByText('Muted for Marketing', { exact: true })).toBeVisible()
  await expect(page.getByText('- muted for Marketing')).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Regulator paused price promotions in Italy/ }),
  ).toHaveAttribute('href', `/inbox?card=${card('check-italy')}`)
  await expect(page.getByRole('link', { name: '2 saved questions need a look' })).toHaveCount(0)

  // A workspace where nothing has raised an alert yet.
  await go(page, '/observability/alerts?state=empty')
  await expect(page.getByText('Nothing has raised an alert yet')).toBeVisible()
})
