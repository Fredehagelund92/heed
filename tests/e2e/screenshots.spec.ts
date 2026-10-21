import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  openPage,
  previews,
  QUALITY_TRY,
  QUALITY_WEEKLY_RUN,
  settingsPages,
  settle,
  themes,
  TRY_IT_MATCH,
  tryItPages,
  widths,
} from './support'
import { ASK_DRAFT, ASK_MATCH, ASK_NO_MATCH, ASK_SHORT, askAndWait } from './ask-support'
import { bodyField, chooseKind, fillContext, summaryField, waitForSaved } from './context-support'
import { openProposal, proposalTitles } from './proposals-support'

/*
  Screenshot tests: the shell, Home on its tabs and quiet, the notifications bell open for a writer and an owner, the
  sidebar's Proposals count, the library grid in its three densities (and with the Issue kind),
  the library's action bar with filters on and with its Filter and Sort menus open, the icon-only
  status column with every status,
  the catalogue in its orders, densities and states, a metric page on each tab and in its states,
  a dimension page with and without a value picked out,
  the item page in the states of its header and on each tab, the user menu of an owner, the
  signed-out page, the Proposals page and a proposal's status page in every state, the To review
  queue and the review screen in every state of the decision bar, a proposal of the queue and
  one of Maria's in the docked panel, a metric and a dimension in the catalogue's panel, the
  Gaps page with its topic counts and a gap in the docked panel for a reader, Health (Quality's,
  the owners' Gaps' and Areas' successor) in its views and records, What an agent would get
  (with Report a gap open) in its states, as a page and in the assistant's panel, Connect an AI app,
  the assistant's Ask tab in its states (a draft to confirm among them) and as a page, MCP and
  gateway's tabs with the traffic by client and tool, Settings and Administration in every
  section for the people who open it, and one target per page template (the tokens preview
  holds the badge sheet), at 1440, 1024 and 390 wide, in light and dark.

  Baselines are Linux baselines produced in CI, never on a laptop (fonts and anti-aliasing differ
  by operating system). The tests run when baselines exist in tests/e2e/__screenshots__, or when
  PW_SCREENSHOTS=1 is set (the update-snapshots workflow does that). Until the first baselines are
  committed they are skipped, and everything else in this folder still runs. See docs/testing.md,
  "Screenshot baselines".
*/

const hasBaselines = existsSync(fileURLToPath(new URL('./__screenshots__', import.meta.url)))

test.skip(
  !hasBaselines && !process.env.PW_SCREENSHOTS,
  'No screenshot baselines yet. Run the update-snapshots workflow, or set PW_SCREENSHOTS=1.',
)
test.skip(
  process.platform !== 'linux' && !process.env.PW_SCREENSHOTS,
  'Screenshot baselines are Linux baselines produced in CI. Set PW_SCREENSHOTS=1 to compare anyway.',
)

/** A term page has its data once the shelf card and the tabs show. */
const termReady = '[data-slot="shelf-card"]'
/** A record open in the docked panel, with its tabs. */
const dockReady = '[data-slot="dock-panel"] [role="tablist"]'

const targets: {
  name: string
  path: string
  density?: string
  catalogueDensity?: string
  /** What shows once the page has its data, when the shell alone is not enough to wait for. */
  ready?: string
  /** A mock scenario (cl.mock-scenario), such as a slow or failed load. */
  scenario?: string
  /** The mock person signed in, by fixture id. */
  person?: string
  /** Opens the user menu before the picture. */
  userMenu?: boolean
  /** Opens one of the library action bar's buttons before the picture, by its accessible name. */
  bar?: RegExp
  /** Opens the notifications bell before the picture. */
  bell?: boolean
  /**
   * Opens the assistant's panel on a tab, and asks for the chips typed into What it is about, or
   * on Ask, asks a question and waits for its answer.
   */
  assistant?: { tab: string; ask?: string[]; question?: string }
  /** On the assistant's page, asks a question and waits for its answer. */
  question?: string
  /** Opens Report a gap from Try it's reply. */
  reportGap?: boolean
}[] = [
  {
    name: 'domain about administrator',
    path: '/health?open=domain:area_sales',
    person: 'per_ravi',
    ready: '[data-slot="domain-about"] [data-slot="markdown"]',
  },
  {
    name: 'domain about owner',
    path: '/health?open=domain:area_sales',
    person: 'per_jon',
    ready: '[data-slot="domain-about"] [data-slot="markdown"]',
  },
  { name: 'shell-library', path: '/library' },
  { name: 'library-compact', path: '/library', density: 'compact' },
  { name: 'library-scope', path: '/library', density: 'scope' },
  { name: 'shell-home', path: '/', ready: '[data-slot="home-grid"]' },
  { name: 'home-known-issues', path: '/?tab=issues', ready: '[data-slot="home-grid"]' },
  { name: 'home-topics', path: '/?tab=topics', ready: '[data-slot="home-grid"]' },
  { name: 'home-quiet', path: '/', scenario: 'quiet', ready: '[data-slot="home-grid-message"]' },
  { name: 'item-guide', path: '/library/itm_jyfuvl07' },
  {
    // Reviewed before served: the stamp under the header names who accepted it (contract 7.2).
    name: 'item-review-stamp',
    path: '/library/itm_wsd3duw0',
    ready: '[data-slot="review-stamp"][data-by="person"]',
  },
  { name: 'user-menu-owner', path: '/', person: 'per_jon', userMenu: true },
  { name: 'signed-out', path: '/signed-out' },
  { name: 'item-ended-source-changed', path: '/library/itm_4u2dvokn' },
  { name: 'item-source-tab', path: '/library/itm_gjdvl50x?tab=source' },
  { name: 'item-history-tab', path: '/library/itm_22ooyz66?tab=history' },
  { name: 'item-links-tab', path: '/library/itm_jyfuvl07?tab=links' },
  { name: 'item-source-missing-owner', path: '/library/itm_gjdvl50x', person: 'per_jon' },
  { name: 'item-active-issue', path: '/library/itm_hp8rnz8i' },
  { name: 'item-issue-with-end-date', path: '/library/itm_lnd2vv9k' },
  { name: 'item-issue-still-going-on', path: '/library/itm_xw5lmhcy', person: 'per_jon' },
  { name: 'item-resolved-issue', path: '/library/itm_l7x3lqic' },
  { name: 'library-issues', path: '/library?kind=issue' },
  { name: 'library-ended-issues-shown', path: '/library?kind=issue&ended=show' },
  {
    name: 'library-bar-filters-on',
    path: '/library?area=area_sales&status=source_missing,stale&kind=event,note',
  },
  { name: 'library-bar-filter-menu', path: '/library?area=area_sales', bar: /^Filter/ },
  { name: 'library-bar-sort-menu', path: '/library', bar: /^Sort(:|, group)/ },
  {
    name: 'library-status-column',
    path: '/library?status=source_missing,needs_check,stale,active_issue,accepted,expired',
  },
  { name: 'catalogue', path: '/catalogue' },
  { name: 'catalogue-a-to-z', path: '/catalogue?order=az' },
  { name: 'catalogue-compact', path: '/catalogue', catalogueDensity: 'compact' },
  { name: 'catalogue-dimensions', path: '/catalogue?kind=dimension' },
  { name: 'catalogue-no-results', path: '/catalogue?q=zzzz' },
  { name: 'catalogue-loading', path: '/catalogue', scenario: 'slow' },
  { name: 'catalogue-empty', path: '/catalogue', scenario: 'no-terms' },
  { name: 'catalogue-error', path: '/catalogue', scenario: 'error' },
  { name: 'catalogue-source-down', path: '/catalogue', scenario: 'source-down' },
  { name: 'dimension', path: '/catalogue/dimension/market', ready: termReady },
  {
    name: 'dimension-value-picked',
    path: '/catalogue/dimension/market?value=netherlands',
    ready: termReady,
  },
  { name: 'metric', path: '/catalogue/metric/orders', ready: termReady },
  { name: 'metric-context', path: '/catalogue/metric/orders?tab=context', ready: termReady },
  { name: 'metric-source', path: '/catalogue/metric/orders?tab=source', ready: termReady },
  { name: 'metric-changed', path: '/catalogue/metric/repeat_purchase_rate', ready: termReady },
  {
    name: 'metric-gone',
    path: '/catalogue/metric/gross_margin',
    scenario: 'definition-gone',
    ready: termReady,
  },
  {
    name: 'metric-not-found',
    path: '/catalogue/metric/no_such_metric',
    ready: '[data-slot="term-not-found"]',
  },
  {
    name: 'metric-error',
    path: '/catalogue/metric/orders',
    scenario: 'error',
    ready: '[role="alert"]',
  },
  { name: 'catalogue-panel-metric', path: '/catalogue?panel=metric:orders', ready: dockReady },
  { name: 'catalogue-panel-dimension', path: '/catalogue?panel=dim:market', ready: dockReady },
  { name: 'editions', path: '/editions', person: 'per_ravi' },
  { name: 'editions-contributor', path: '/editions' },
  {
    name: 'editions-administrator',
    path: '/editions?edition=2026-10-02.1',
    person: 'per_ravi',
    ready: dockReady,
  },
  { name: 'editions-table', path: '/editions?view=table', person: 'per_ravi' },
  { name: 'edition-page', path: '/editions/2026-09-27.1', person: 'per_ravi' },
  { name: 'try-it', path: '/try-it', ready: '[data-state="try-it-intro"]' },
  ...tryItPages.map(({ name, ...target }) => ({ ...target, name: name.replaceAll(' ', '-') })),
  {
    name: 'try-it-error',
    path: TRY_IT_MATCH,
    scenario: 'error',
    ready: '[data-slot="try-it-error"]',
  },
  {
    name: 'try-it-report-gap',
    path: '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=1999-01-01&to=1999-01-31',
    ready: '[data-slot="try-it-no-match"]',
    reportGap: true,
  },
  { name: 'connect', path: '/settings?section=connect', ready: '[data-slot="connect"]' },
  { name: 'assistant-try-it', path: '/', assistant: { tab: 'Try a question' } },
  {
    name: 'assistant-try-it-delivered',
    path: '/',
    assistant: { tab: 'Try a question', ask: ['Average order', 'United Kingdom'] },
  },
  { name: 'assistant-ask', path: '/', assistant: { tab: 'Ask' } },
  {
    name: 'assistant-ask-answer',
    path: '/',
    assistant: { tab: 'Ask', question: ASK_MATCH },
  },
  {
    name: 'assistant-ask-not-found',
    path: '/',
    assistant: { tab: 'Ask', question: ASK_NO_MATCH },
  },
  {
    name: 'assistant-ask-limit',
    path: '/',
    scenario: 'assistant-limit',
    assistant: { tab: 'Ask', question: ASK_MATCH },
  },
  {
    name: 'assistant-ask-failed',
    path: '/',
    scenario: 'assistant-fails',
    assistant: { tab: 'Ask', question: ASK_MATCH },
  },
  {
    name: 'assistant-ask-short',
    path: '/',
    assistant: { tab: 'Ask', question: ASK_SHORT },
  },
  {
    name: 'assistant-ask-long',
    path: '/',
    assistant: { tab: 'Ask', question: 'What does the Sales domain cover?' },
  },
  {
    name: 'assistant-ask-draft',
    path: '/',
    assistant: { tab: 'Ask', question: ASK_DRAFT },
  },
  { name: 'assistant-page', path: '/assistant', question: ASK_MATCH },
  { name: 'gateway-clients', path: '/admin?section=gateway', person: 'per_ravi' },
  {
    name: 'gateway-connections',
    path: '/admin?section=gateway&tab=connections',
    person: 'per_ravi',
    ready: '[data-slot="ai-connections-count"]',
  },
  {
    name: 'gateway-connections-empty',
    path: '/admin?section=gateway&tab=connections',
    person: 'per_ravi',
    scenario: 'empty',
  },
  { name: 'gateway-tools', path: '/admin?section=gateway&tab=tools', person: 'per_ravi' },
  {
    name: 'gateway-activity',
    path: '/admin?section=gateway&tab=activity',
    person: 'per_ravi',
    ready: '[data-slot="traffic"]',
  },
  {
    name: 'gateway-activity-empty',
    path: '/admin?section=gateway&tab=activity',
    person: 'per_ravi',
    scenario: 'empty',
  },
  // Settings and Administration (slice W11b): every section, for the people who open it.
  ...settingsPages.map(({ name, ...target }) => ({
    name: name.replaceAll(/[ ,]+/g, '-'),
    ...target,
  })),
  {
    name: 'administration-operations-runner-stopped',
    path: '/admin?section=operations',
    person: 'per_ravi',
    scenario: 'runner-stopped',
    ready: '[data-slot="runner-stopped"]',
  },
  {
    name: 'administration-limits-error',
    path: '/admin?section=limits',
    person: 'per_ravi',
    scenario: 'error',
  },
  { name: 'gateway-loading', path: '/admin?section=gateway', person: 'per_ravi', scenario: 'slow' },
  { name: 'gateway-error', path: '/admin?section=gateway', person: 'per_ravi', scenario: 'error' },
  { name: 'administration-contributor', path: '/admin?section=gateway' },
  { name: 'gaps', path: '/gaps' },
  { name: 'gaps-topic-counts', path: '/gaps?view=topics' },
  { name: 'gaps-panel', path: '/gaps?gap=ca9a0000-0000-4000-8000-000000000001' },
  { name: 'gaps-panel-spans-domains', path: '/gaps?gap=ca9a0000-0000-4000-8000-000000000005' },
  { name: 'gaps-empty', path: '/gaps', scenario: 'empty' },
  { name: 'gaps-error', path: '/gaps', scenario: 'error' },
  // Health (the Workbench then) took over Quality and the owners' Gaps (slice W8).
  {
    name: 'health-administrator',
    path: '/health',
    person: 'per_ravi',
    ready: '[data-slot="quality-verdict"]',
  },
  {
    name: 'health-owner',
    path: '/health',
    person: 'per_jon',
    ready: '[data-slot="quality-verdict"]',
  },
  {
    name: 'health-first-run',
    path: '/health',
    person: 'per_ravi',
    scenario: 'empty',
    ready: '[data-slot="quality-verdict"]',
  },
  {
    name: 'health-test-questions',
    path: '/health?view=questions',
    person: 'per_jon',
    ready: '[data-row-link]',
  },
  {
    name: 'health-runs',
    path: '/health?view=runs',
    person: 'per_ravi',
    ready: '[data-row-link]',
  },
  {
    name: 'health-gaps-from-people',
    path: '/health?view=gaps&origin=person',
    person: 'per_jon',
    ready: '[data-row-link]',
  },
  {
    name: 'health-domain-record',
    path: '/health?open=domain:area_sales',
    person: 'per_jon',
    ready: '[data-slot="record-pane"] [data-slot="trend-chart"]',
  },
  {
    name: 'health-question-record',
    path: '/health?view=questions&open=question:units-sold-source-lag&tab=result',
    person: 'per_jon',
    ready: '[data-slot="record-pane"] h2',
  },
  {
    name: 'health-run-changes',
    path: `/health?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=changes`,
    person: 'per_ravi',
    ready: '[data-slot="comparison-verdict"]',
  },
  {
    name: 'health-transcript',
    path: `/health?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=results&cell=${QUALITY_TRY}`,
    person: 'per_ravi',
    ready: '[data-slot="transcript"] [aria-label="Checks"]',
  },
  {
    name: 'health-gap-record',
    path: '/health?open=gap:ca9a0000-0000-4000-8000-000000000009',
    person: 'per_ravi',
    ready: '[data-slot="record-pane"] h2',
  },
  {
    name: 'proposals-panel-review',
    path: '/proposals?panel=00000000-0000-4000-8000-00000000005a',
    person: 'per_jon',
    ready: '[data-slot="dock-panel"] [data-slot="decision-bar"]',
  },
  {
    name: 'proposals-panel-mine',
    path: '/proposals?view=mine&panel=00000000-0000-4000-8000-000000000035',
    ready: dockReady,
  },
  { name: 'notifications-writer', path: '/proposals', bell: true },
  { name: 'notifications-owner', path: '/library', person: 'per_jon', bell: true },
  { name: 'proposals-count-owner', path: '/library', person: 'per_jon' },
  ...previews.map(({ name, path }) => ({ name: `preview-${name}`, path })),
]

for (const size of widths) {
  for (const theme of themes) {
    for (const target of targets) {
      test(`${target.name} at ${size.name}px, ${theme}`, async ({ page }) => {
        if (target.density) {
          await page.addInitScript(
            (density) => window.localStorage.setItem('cl.library.density', JSON.stringify(density)),
            target.density,
          )
        }
        if (target.catalogueDensity) {
          await page.addInitScript(
            (density) =>
              window.localStorage.setItem('cl.catalogue.density', JSON.stringify(density)),
            target.catalogueDensity,
          )
        }
        if (target.scenario) {
          await page.addInitScript(
            (scenario) => window.localStorage.setItem('cl.mock-scenario', scenario),
            target.scenario,
          )
        }
        if (target.person) {
          await page.addInitScript(
            (person) => window.localStorage.setItem('cl.mock-person', person),
            target.person,
          )
        }
        await openPage(page, target.path, { ...size, theme })
        if (target.ready)
          await expect(page.locator(target.ready).first()).toBeVisible({ timeout: 15_000 })
        if (target.scenario === 'slow')
          await expect(page.getByRole('status', { name: /^Loading the/ }).first()).toBeVisible()
        if (target.path.includes('gap=')) {
          // A gap in the panel: its chart is a lazy chunk, and the panel slides in.
          await expect(page.locator('[data-slot="weekly-chart"]')).toBeVisible()
          await settle(page)
        }
        if (target.userMenu) {
          if (size.width < 768) await page.getByRole('button', { name: 'Open navigation' }).click()
          await page
            .locator('[data-slot="sidebar"]')
            .getByRole('button', { name: /Jon Abara/ })
            .last()
            .click()
          await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
          await settle(page)
        }
        if (target.bar) {
          // On a phone Sort lives in the folded menu, which the same pattern names.
          await page
            .getByRole('search', { name: 'Library' })
            .getByRole('button', { name: target.bar })
            .click()
          await expect(
            page.locator('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]'),
          ).toBeVisible()
          await settle(page)
        }
        if (target.bell) {
          await page.getByRole('button', { name: /^Notifications/ }).click()
          await expect(
            page.getByRole('dialog', { name: 'Notifications' }).getByRole('listitem').first(),
          ).toBeVisible()
          await settle(page)
        }
        if (target.assistant) {
          const panel = page.getByRole(
            (page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region',
            { name: 'Assistant' },
          )
          await page.getByRole('button', { name: 'Assistant', exact: true }).click()
          await panel.getByRole('tab', { name: target.assistant.tab }).click()
          if (target.assistant.ask) {
            const chips = panel.getByRole('combobox', { name: 'What it is about' })
            for (const words of target.assistant.ask) {
              await chips.fill(words)
              await expect(
                page.getByRole('option', { name: new RegExp(`^${words}`) }).first(),
              ).toBeVisible()
              await chips.press('Enter')
            }
            await panel.getByRole('button', { name: 'Show what AI apps get' }).click()
            await expect(panel.locator('[data-slot="try-it-delivered"]')).toBeVisible()
          } else if (target.assistant.question) {
            await askAndWait(page, target.assistant.question)
          } else {
            await expect(panel.getByRole('tabpanel')).toBeVisible()
          }
          await settle(page)
        }
        if (target.question) await askAndWait(page, target.question)
        if (target.reportGap) {
          await page.getByRole('button', { name: 'Report a gap' }).click()
          await expect(page.getByRole('dialog', { name: 'Report a gap' })).toBeVisible()
          await settle(page)
        }
        await expect(page).toHaveScreenshot(`${target.name}-${size.name}-${theme}.png`, {
          fullPage: false,
        })
      })
    }
  }
}

for (const size of [...widths, { name: '360', width: 360, height: 780 }]) {
  for (const theme of themes) {
    for (const state of [
      'empty',
      'filled-issue',
      'saved',
      'errors',
      'mention',
      'saving',
      'slash',
      'toolbar',
      'text-check',
      'agent-view',
    ]) {
      test(`add-context ${state} at ${size.name}px, ${theme}`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-08T09:41:00'))
        if (state === 'saving')
          await page.addInitScript(() => localStorage.setItem('cl.mock-scenario', 'slow'))
        await openPage(page, '/library/new', { ...size, theme })
        const summary = summaryField(page)
        await expect(summary).toBeVisible()
        if (!['empty', 'errors', 'mention', 'slash', 'toolbar'].includes(state)) {
          await fillContext(page, { issue: state === 'filled-issue' })
          if (state === 'saving')
            await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute(
              'data-status',
              'saving',
            )
          else await waitForSaved(page)
        }
        if (state === 'errors')
          await page
            .getByRole('button', { name: 'Send for review', exact: true })
            .filter({ visible: true })
            .click()
        if (state === 'mention') {
          await summary.fill('Compare ')
          await summary.pressSequentially('@Dep')
          await expect(
            page.getByRole('listbox', { name: 'Mention a metric, value, fact or domain' }),
          ).toBeVisible()
        }
        if (state === 'slash' || state === 'toolbar') {
          await chooseKind(page, 'Guide')
          await bodyField(page).click()
          await page.keyboard.type(state === 'slash' ? '/' : 'Check the period first.')
          if (state === 'toolbar') await bodyField(page).getByText('Check the period').selectText()
        }
        if (state === 'text-check') {
          await bodyField(page).click()
          await page.keyboard.type('Send the detail to anna.berg@example.com.')
        }
        if (state === 'agent-view')
          await page.getByRole('tab', { name: 'What AI apps get' }).click()
        if (state !== 'saving') await settle(page)
        await expect(page).toHaveScreenshot(`add-context-${state}-${size.name}-${theme}.png`, {
          fullPage: true,
        })
      })
    }
  }
}

const proposalShots = [
  { name: 'draft', title: proposalTitles.draft },
  { name: 'submitted', title: proposalTitles.waiting },
  { name: 'in-review', title: proposalTitles.inReview },
  { name: 'changes-requested', title: proposalTitles.changesRequested },
  { name: 'accepted', title: proposalTitles.accepted },
  { name: 'rejected', title: proposalTitles.rejected },
  { name: 'withdrawn', title: proposalTitles.withdrawn },
] as const

for (const size of widths) {
  for (const theme of themes) {
    test(`proposals-mine at ${size.name}px, ${theme}`, async ({ page }) => {
      await openPage(page, '/proposals', { ...size, theme })
      await expect(page.getByRole('table', { name: 'Your proposals' })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`proposals-mine-${size.name}-${theme}.png`, {
        fullPage: true,
      })
    })
    for (const shot of proposalShots) {
      test(`proposal-${shot.name} at ${size.name}px, ${theme}`, async ({ page }) => {
        await openPage(page, '/proposals', { ...size, theme })
        await openProposal(page, shot.title)
        await settle(page)
        await expect(page).toHaveScreenshot(`proposal-${shot.name}-${size.name}-${theme}.png`, {
          fullPage: true,
        })
      })
    }
  }
}

/**
 * The review queue and the review screen as Jon (slice W5): every state of his decision bar; and
 * a proposal an AI app drafted, as its owner.
 */
const reviewShots = [
  { name: 'review-queue', path: '/proposals' },
  { name: 'review-ready', path: '/proposals/00000000-0000-4000-8000-00000000005a' },
  { name: 'review-approver-next', path: '/proposals/00000000-0000-4000-8000-000000000042' },
  { name: 'review-claimed', path: '/proposals/00000000-0000-4000-8000-000000000028' },
  { name: 'review-proposer', path: '/proposals/00000000-0000-4000-8000-000000000064' },
  { name: 'review-check-failed', path: '/proposals/00000000-0000-4000-8000-00000000002f' },
  { name: 'review-retire', path: '/proposals/00000000-0000-4000-8000-000000000026' },
  // A proposal an AI app drafted for Priya, as Tomas, its owner: no mark of who wrote it.
  {
    name: 'review-agent-drafted',
    path: '/proposals/00000000-0000-4000-8000-00000000007e',
    person: 'per_tomas',
  },
] as const

for (const size of widths) {
  for (const theme of themes) {
    for (const shot of reviewShots) {
      test(`${shot.name} at ${size.name}px, ${theme}`, async ({ page }) => {
        const person = 'person' in shot ? shot.person : 'per_jon'
        await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), person)
        await openPage(page, shot.path, { ...size, theme })
        await page.waitForSelector('[data-slot="review-queue"], [data-slot="decision-bar"]')
        await settle(page)
        // Viewport size, not full page: the decision bar sticks to the bottom of the window.
        await expect(page).toHaveScreenshot(`${shot.name}-${size.name}-${theme}.png`)
      })
    }
  }
}

/**
 * MCP and gateway's dialogs (slice W11a): the client editor, the tool switch, and disconnecting
 * one of a person's AI apps.
 */
const gatewayDialogs = [
  {
    name: 'edit-client',
    path: '/admin?section=gateway',
    open: { role: 'button', name: 'Edit Cursor' },
  },
  {
    name: 'add-client-errors',
    path: '/admin?section=gateway',
    open: { role: 'button', name: 'Add an AI app' },
  },
  {
    name: 'tool-switch-off',
    path: '/admin?section=gateway&tab=tools',
    open: { role: 'switch', name: 'Get facts for a question' },
  },
  {
    name: 'disconnect-app',
    path: '/admin?section=gateway&tab=connections',
    open: { role: 'button', name: 'Disconnect Claude Code for Jon Abara' },
  },
] as const

for (const size of widths) {
  for (const theme of themes) {
    for (const shot of gatewayDialogs) {
      test(`gateway-${shot.name} at ${size.name}px, ${theme}`, async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
        await openPage(page, shot.path, { ...size, theme })
        await page.getByRole(shot.open.role, { name: shot.open.name }).click()
        const dialog = page.locator('[role="dialog"], [role="alertdialog"]')
        await expect(dialog).toBeVisible()
        if (shot.name === 'add-client-errors')
          await dialog.getByRole('button', { name: 'Add AI app' }).click()
        await settle(page)
        await expect(page).toHaveScreenshot(`gateway-${shot.name}-${size.name}-${theme}.png`, {
          fullPage: false,
        })
      })
    }
  }
}
