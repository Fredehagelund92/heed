import { expect, type Locator, type Page } from '@playwright/test'

/** The viewport and appearance matrix every shell test runs through. */
export const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844 },
] as const

export const themes = ['light', 'dark'] as const
export type Theme = (typeof themes)[number]

/** Pages that have a shell around them. */
export const routes = [
  { name: 'home', path: '/' },
  { name: 'library', path: '/library' },
  { name: 'catalogue', path: '/catalogue' },
  { name: 'proposals', path: '/proposals' },
  { name: 'try it', path: '/try-it' },
  { name: 'assistant', path: '/assistant' },
  { name: 'connect your AI', path: '/settings?section=connect' },
  { name: 'gaps', path: '/gaps' },
  { name: 'health', path: '/health' },
  { name: 'editions', path: '/editions' },
  { name: 'administration', path: '/admin' },
  { name: 'settings', path: '/settings' },
  { name: 'docs', path: '/docs' },
  { name: 'docs page', path: '/docs/mcp' },
] as const

/**
 * The item page in the states of its header (calm, a warning with its note, an active and an
 * ended issue, retired) and on each of its tabs.
 */
export const itemPages = [
  { name: 'item calm', path: '/library/itm_jyfuvl07' },
  { name: 'item ended and source changed', path: '/library/itm_4u2dvokn' },
  { name: 'item source missing, high risk, source tab', path: '/library/itm_gjdvl50x?tab=source' },
  { name: 'item retired, history tab', path: '/library/itm_22ooyz66?tab=history' },
  { name: 'item guide, links tab', path: '/library/itm_jyfuvl07?tab=links' },
  { name: 'item active issue', path: '/library/itm_hp8rnz8i' },
  { name: 'item issue still going on', path: '/library/itm_xw5lmhcy' },
  { name: 'item resolved issue', path: '/library/itm_l7x3lqic' },
] as const

/**
 * A record open in the docked panel (design round 3): an item of the library on a few of its
 * tabs, one of Maria's proposals, a metric and a dimension of the catalogue, and a gap.
 */
export const panelPages = [
  { name: 'library panel', path: '/library?panel=itm_jyfuvl07' },
  {
    name: 'library panel source missing, source tab',
    path: '/library?panel=itm_gjdvl50x&tab=source',
  },
  { name: 'library panel history tab', path: '/library?panel=itm_zgk6ael1&tab=history' },
  {
    name: 'proposals panel changes requested',
    path: '/proposals?view=mine&panel=00000000-0000-4000-8000-000000000035',
  },
  {
    name: 'proposals panel draft, checks tab',
    path: '/proposals?view=mine&panel=00000000-0000-4000-8000-000000000058&tab=checks',
  },
  { name: 'catalogue panel metric', path: '/catalogue?panel=metric:orders' },
  {
    name: 'catalogue panel metric, source tab',
    path: '/catalogue?panel=metric:orders&tab=source',
  },
  { name: 'catalogue panel dimension', path: '/catalogue?panel=dim:market' },
  { name: 'gaps panel', path: '/gaps?gap=ca9a0000-0000-4000-8000-000000000001' },
] as const

/** A scope the mock's live edition delivers facts for: Average order value in the United Kingdom, 30 days. */
export const TRY_IT_MATCH =
  '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=2026-09-08&to=2026-10-07'

/**
 * What an agent would get and Connect an AI app in their states: facts delivered, none apply, the
 * dates missing, the Connect tab, and the Connect page for an administrator.
 */
export const tryItPages = [
  {
    name: 'try it delivered',
    path: TRY_IT_MATCH,
    // Each fact's review stamp names who accepted it once Heed has read it (FR-326).
    ready: '[data-slot="try-it-delivered"] [data-slot="review-stamp"][data-by="person"]',
  },
  {
    name: 'try it no match',
    path: '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=1999-01-01&to=1999-01-31',
    ready: '[data-slot="try-it-no-match"]',
  },
  {
    // Without dates, a scope is read at today and the reply says so (FR-304).
    name: 'try it without dates',
    path: '/try-it?about=metric:average_order_value',
    ready: '[data-slot="try-it-outcome"]',
  },
  {
    name: 'connect as an administrator',
    path: '/settings?section=connect',
    person: 'per_ravi',
    ready: '[data-slot="connect"]',
  },
] as const

/**
 * The mock's weekly run of Sales on Monday 5 October 2026, one of its tries, and the first
 * try of the demo's regression, which fails (src/web/mocks/items.ts, `regression`).
 */
export const QUALITY_WEEKLY_RUN = '00000000-0000-4000-b000-000000000090'
export const QUALITY_TRY = '00000000-0000-4000-b000-00000009002b'
export const QUALITY_FAILED_TRY = '00000000-0000-4000-b000-00000009001f'

/**
 * Ten editions of the mock for what changed between editions: eight items added, the demo's
 * regression changed (its note ended) and one item saved again.
 */
export const COMPARE_RANGE = 'since=2026-09-10.2&until=2026-10-07.1'

/**
 * Release and editions (slice W6) and Health, as the people they are for: the editions, the
 * list's second page and an edition page as an administrator and as an owner, Health as an
 * owner and an administrator, with its views and records (Quality's pages before slice W8),
 * and a domain's record, with what it is (the Areas page before the navigation decision), and its team.
 */
export const releasePages = [
  { name: 'editions as an administrator', path: '/editions', person: 'per_ravi' },
  { name: 'editions as an owner', path: '/editions', person: 'per_jon' },
  {
    name: 'editions, an edition open',
    path: '/editions?edition=2026-10-07.1',
    person: 'per_ravi',
    ready: '[data-slot="dock-panel"] article',
  },
  { name: 'editions table', path: '/editions?view=table', person: 'per_ravi' },
  {
    name: 'editions table, an edition open',
    path: '/editions?view=table&edition=2026-10-02.1',
    person: 'per_ravi',
    ready: '[data-slot="dock-panel"] article',
  },
  { name: 'editions second page', path: '/editions?view=table&page=2', person: 'per_ravi' },
  { name: 'edition page', path: '/editions/2026-10-07.1', person: 'per_ravi' },
  { name: 'unknown edition', path: '/editions/2020-01-01.9', person: 'per_ravi' },
  {
    name: 'what changed between editions',
    path: `/editions/compare?${COMPARE_RANGE}`,
    person: 'per_ravi',
    ready: '[data-slot="compare-list"] [data-row-id]',
  },
  {
    name: 'what changed, an item open',
    path: `/editions/compare?${COMPARE_RANGE}&item=itm_q2upr28v`,
    person: 'per_ravi',
    ready: '[data-slot="dock-panel"] article',
  },
  {
    name: 'what changed, edition by edition',
    path: `/editions/compare?${COMPARE_RANGE}&view=steps`,
    person: 'per_ravi',
    ready: '[data-row-id]',
  },
  {
    name: 'what changed, nothing different',
    path: '/editions/compare?since=2026-10-07.1&until=2026-10-07.1',
    person: 'per_ravi',
    ready: 'text=These are the same edition',
  },
  { name: 'health as an owner', path: '/health', person: 'per_jon' },
  { name: 'health as an administrator', path: '/health', person: 'per_ravi' },
  { name: 'health test questions', path: '/health?view=questions', person: 'per_jon' },
  { name: 'health runs', path: '/health?view=runs', person: 'per_ravi' },
  { name: 'health gaps', path: '/health?view=gaps', person: 'per_jon' },
  {
    name: 'health domain record',
    path: '/health?open=domain:area_sales',
    person: 'per_jon',
  },
  {
    name: 'health domain team, administrator',
    path: '/health?open=domain:area_sales&tab=team',
    person: 'per_ravi',
    ready: '[data-slot="domain-team"] ul',
  },
  {
    name: 'health question record, test result tab',
    path: '/health?view=questions&open=question:units-sold-source-lag&tab=result',
    person: 'per_jon',
  },
  {
    name: 'health run record, changes tab',
    path: `/health?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=changes`,
    person: 'per_ravi',
  },
  {
    name: 'health transcript',
    path: `/health?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=results&cell=${QUALITY_TRY}`,
    person: 'per_ravi',
  },
] as const

/** MCP and gateway (slice W11a), in Administration, as the administrator who manages it. */
export const gatewayPages = [
  { name: 'gateway clients', path: '/admin?section=gateway' },
  { name: 'gateway connections', path: '/admin?section=gateway&tab=connections' },
  { name: 'gateway tools', path: '/admin?section=gateway&tab=tools' },
  { name: 'gateway activity', path: '/admin?section=gateway&tab=activity' },
] as const
export const GATEWAY_ADMIN = 'per_ravi'

/**
 * Settings and Administration (slice W11b; navigation decision, 12 October 2026) in their
 * sections, for the people who open each: everyone's profile and Connect an AI app, an auditor's
 * history log, a section refused to an auditor, Administration refused to an owner, and every
 * section of an administrator, with a setting and a log entry open in the docked panel. `ready`
 * is what shows once the data is in.
 */
export const settingsPages = [
  { name: 'settings profile', path: '/settings', ready: '[data-slot="settings-profile"]' },
  {
    name: 'settings connect your AI',
    path: '/settings?section=connect',
    ready: '[data-slot="connected-apps"]',
  },
  {
    name: 'administration refused',
    path: '/admin',
    person: 'per_jon',
    ready: 'text=Administration is for admins and auditors',
  },
  {
    name: 'administration section refused, auditor',
    path: '/admin?section=limits',
    person: 'per_ella',
    ready: '[data-slot="settings-refused"]',
  },
  {
    name: 'administration history log, auditor',
    path: '/admin',
    person: 'per_ella',
    ready: '[data-slot="settings-audit"]',
  },
  {
    name: 'administration domains',
    path: '/admin?section=domains',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="settings-domains"]',
  },
  {
    name: 'administration about our business',
    path: '/admin?section=business',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="business-preview"]',
  },
  {
    name: 'administration sources',
    path: '/admin?section=sources',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="settings-source-list"]',
  },
  {
    name: 'administration sources, the Cube page',
    path: '/admin?section=sources&source=cube',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="source-read-list"]',
  },
  {
    name: 'administration sources, the Cube page with a setting open',
    path: '/admin?section=sources&source=cube&setting=sources.cube_model_url',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="dock-panel"] form',
  },
  {
    name: 'administration limits',
    path: '/admin?section=limits',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="settings-limits"]',
  },
  {
    name: 'administration limits, a setting open',
    path: '/admin?section=limits&setting=limits.mcp_requests_per_minute',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="dock-panel"] form',
  },
  {
    name: 'administration people',
    path: '/admin?section=people',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="settings-people"] [data-person]',
  },
  {
    name: 'administration people, a person open',
    path: '/admin?section=people&person=per_jon',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="person-roles"]',
  },
  {
    name: 'administration history log, an entry open',
    path: '/admin?section=audit&entry=4',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="audit-entry"]',
  },
  {
    name: 'administration operations',
    path: '/admin?section=operations',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="settings-sources"]',
  },
  {
    name: 'administration import',
    path: '/admin?section=import',
    person: GATEWAY_ADMIN,
    ready: '[data-slot="import-block"]',
  },
] as const

/** One screenshot target per page template, plus the tokens, the inputs and the proposal parts. */
export const previews = [
  { name: 'list', path: '/design-preview/list', template: 'list' },
  { name: 'document', path: '/design-preview/document', template: 'document' },
  { name: 'overview', path: '/design-preview/overview', template: 'overview' },
  { name: 'empty', path: '/design-preview/empty', template: 'empty' },
  { name: 'health-page', path: '/design-preview/workbench', template: 'workbench' },
  { name: 'tokens', path: '/design-preview/tokens', template: 'tokens' },
  { name: 'inputs', path: '/design-preview/inputs', template: 'inputs' },
  { name: 'proposal-parts', path: '/design-preview/proposal-parts', template: 'proposal-parts' },
] as const

/** Sets the viewport and the saved appearance, opens the page and waits until it is stable. */
export async function openPage(
  page: Page,
  path: string,
  { width, height, theme }: { width: number; height: number; theme: Theme },
) {
  await page.setViewportSize({ width, height })
  // Only the first load sets the appearance, so a test can change it and reload.
  await page.addInitScript((appearance) => {
    if (window.localStorage.getItem('cl.appearance') === null) {
      window.localStorage.setItem('cl.appearance', appearance)
    }
  }, theme)
  await page.goto(path)
  // Generous: a busy machine running many browsers at once can take a few seconds.
  await expect(page.locator('[data-slot="page"]')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Waits until no animation is running, such as an overlay's fade in. A check made mid fade sees
 * a half transparent overlay (axe then reports low contrast, and boxes are still scaled).
 */
export async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
}

/**
 * The left edge of a region's content box: where its first child can start. Measuring the
 * content box (border box plus left padding) is what the layout test compares.
 */
export async function contentLeft(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ state: 'attached' })
  // Found and measured in one step: a list that swaps its loading rows for its data between the
  // two would otherwise leave a detached element, whose padding reads as nothing (NaN).
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Nothing matches ${selector}`)
    const box = element.getBoundingClientRect()
    return box.left + Number.parseFloat(getComputedStyle(element).paddingLeft)
  }, selector)
}

/**
 * A page rail is flat (contract 5, "Document page"): one hairline on the side that meets the main
 * column (left beside it, top when it stacks under it, bottom when it stacks above), and no
 * section in it with a rounded outline, a side line or its own background.
 */
export async function expectFlatRail(rail: Locator, side: 'left' | 'top' | 'bottom') {
  const look = await rail.evaluate((element) => {
    const style = getComputedStyle(element)
    const cards = [...element.children]
      .map((child) => getComputedStyle(child))
      .filter(
        (child) =>
          child.borderTopLeftRadius !== '0px' ||
          child.borderLeftWidth !== '0px' ||
          child.backgroundColor !== 'rgba(0, 0, 0, 0)',
      )
    return {
      left: style.borderLeftWidth,
      top: style.borderTopWidth,
      bottom: style.borderBottomWidth,
      radius: style.borderTopLeftRadius,
      cards: cards.length,
    }
  })
  expect(look.cards, 'a section of the rail is a card').toBe(0)
  expect(look.radius).toBe('0px')
  expect({ left: look.left, top: look.top, bottom: look.bottom }).toEqual({
    left: side === 'left' ? '1px' : '0px',
    top: side === 'top' ? '1px' : '0px',
    bottom: side === 'bottom' ? '1px' : '0px',
  })
}

/**
 * Chooses a person in a person picker inside `scope` (a dialog or a filter row): types `words`,
 * which Heed searches on the server, and picks the option with this name.
 */
export async function choosePerson(scope: Locator, words: string, name: string) {
  const input = scope.getByRole('combobox', { name: 'Person' })
  await input.fill(words)
  await scope
    .page()
    .getByRole('option', { name: new RegExp(`^${name}`) })
    .click()
  await expect(input).toHaveValue(name)
}
