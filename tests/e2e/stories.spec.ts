import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { themes } from './support'

/*
  The form kit's Storybook stories, the release stories, the notification stories and the
  others below, in a real browser, in light and dark (contract 7, "the state set", and the W1,
  W5, W6, W7 and W11a slices of the front end plan, W11a for the gateway stories): each story
  renders, its play function (the keyboard interaction test) finishes without an error, and axe
  finds no WCAG 2.2 AA violation.
  The Bin stories and the library's empty and administrator states, Mine's draft stories, the gaps stories (slice W9), the Home stories, the Docs stories and the help link stories, the Health stories (with Quality's parts and
  what a domain is), the chip previews, the Try it stories, the Ask stories, the agent change parts and the answer formatting stories, the sign-in stories
  and the Settings and Administration stories run the same way.
  Runs against the static Storybook build (`npm run build-storybook`), served by the second web
  server in playwright.config.ts.
*/

const storybook = `http://localhost:${process.env.PW_STORYBOOK_PORT ?? 4183}`

type Entry = { id: string; title: string; name: string; type: string }

async function storiesWhere(page: Page, keep: (entry: Entry) => boolean): Promise<Entry[]> {
  const response = await page.request.get(`${storybook}/index.json`)
  const index = (await response.json()) as { entries: Record<string, Entry> }
  return Object.values(index.entries).filter((entry) => entry.type === 'story' && keep(entry))
}

const formStories = (page: Page) => storiesWhere(page, (entry) => entry.title.startsWith('Forms/'))

/** The library's action bar in each of its states, and the status column's key. */
const barStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) =>
      (entry.title === 'Library/Library page' &&
        /Menu Open|Action Bar|Phone (Search|Filters)/.test(entry.name)) ||
      (entry.title === 'Library/Badges' && entry.name === 'Status Column'),
  )

/** The Bin, and the library's empty and administrator states that lead to it. */
const binStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) =>
      entry.title === 'Library/Bin' ||
      (entry.title === 'Library/Library page' &&
        /^(Empty Library|Nearly Empty|Administrator Row Menu|Administrator View Menu|Move To Bin Dialog)$/.test(
          entry.name,
        )),
  )

/** Proposals > Mine on the drafts: selected for a discard, its confirmation, and none left. */
const draftStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) =>
      entry.title === 'Pages/Proposals' &&
      /^(Mine Drafts Selected|Mine Discard Dialog|Mine No Drafts)$/.test(entry.name),
  )

/** The Heed marks and the badges that draw them: kinds, statuses and long domain names. */
const markStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) =>
      entry.title === 'Library/Badges' &&
      /^(Heed Marks|Kinds|Statuses|Long Domain Names)$/.test(entry.name),
  )

/** Release and editions: the pages, the release dialogs and the banner (slice W6). */
const releaseStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title.startsWith('Release/'))

/** The Gaps page in its states, a gap in the docked panel and the weekly counts (slice W9). */
const gapStories = (page: Page) => storiesWhere(page, (entry) => entry.title.startsWith('Gaps/'))
/** The notifications under the bell and the sidebar count (slice W7). */
const notificationStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title.startsWith('Notifications/'))

/** The review queue, the review screen in every decision state and its parts (slice W5). */
const reviewStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Pages/Review')

/** The flat page rail: beside a page, in a panel, long text and empty sections. */
const railStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Parts/Page rail')

/** The docked panel on its own and with a library item in the real shell (design round 3). */
const dockStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Parts/Dock panel')

/** The page editor as a bordered field with mentions off: what a domain is, About our business. */
const aboutFieldStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) => entry.title === 'Parts/Page editor' && entry.name.startsWith('About Field'),
  )

/** MCP and gateway: the pages, the client editor and the tool switch (slice W11a). */
const gatewayStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Administration/MCP and gateway')

/** A person's own Settings, its connect card, and Administration's sections (navigation decision). */
const settingsStories = (page: Page) =>
  storiesWhere(page, (entry) =>
    ['Settings/Settings', 'Settings/Connect card', 'Administration/Administration'].includes(
      entry.title,
    ),
  )

/** Home: the first visit, a returning one, Your drafts (with mixed rows) and none, the suggestions, the tabs and the empty states. */
const homeStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Pages/Home')
/**
 * The Docs area in docs mode: its home, a section, search and the tree's keys, a concept, a guide,
 * the glossary and the phone's drawer (docs/help).
 */
const docsStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Pages/Docs')
/** Help in context: the help link in a sentence, after a heading, in an empty state, open. */
const helpStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Parts/Help link')
/**
 * Health in its states, its records (W6b, W6c), the compare focus (W7), the record pane and the
 * work list's rows (W4, W5), the parts of the test results it shows, Quality's (W8), what a
 * domain is and describing it, and a gap's verification by test with its linked tests (V5).
 */
const healthStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title.startsWith('Health/'))
/** The chip previews: every card, missing targets, the phone sheet, the @ list peek. */
const previewStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Parts/Chip previews')
/** What an agent would get: the page, the panel and the reply's parts. */
const tryItStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Assistant/Try it')

/** The assistant's Ask tab in every state. */
const askStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Assistant/Ask')
/** The step trail and the change card on their own: one grammar for an agent's change. */
const agentChangeStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Parts/Agent changes')
/** How an answer's Markdown reads: one story for each kind, and a table while it streams. */
const answerStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Assistant/Answer formatting')
const signInStories = (page: Page) => storiesWhere(page, (entry) => entry.title === 'Shell/Sign in')

/** The search text sizes, the rail's user avatar and a term's Also mentioned list. */
const fitStories = (page: Page) =>
  storiesWhere(
    page,
    (entry) =>
      (entry.title === 'Parts/Small parts' && entry.name === 'Input Sizes') ||
      (entry.title === 'Shell/App shell' && entry.name === 'Laptop Rail') ||
      (entry.title === 'Catalogue/Metric page' && entry.name === 'Context Tab Also Mentioned'),
  )

/** The checks a draft written for a person asks of them: the notice, the flags, the sources. */
const draftChecksStories = (page: Page) =>
  storiesWhere(page, (entry) => entry.title === 'Proposal parts' && entry.name === 'Draft Checks')

const settled = new Set(['finished', 'errored', 'aborted'])

function phaseOf(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
        .__STORYBOOK_PREVIEW__?.currentRender?.phase ?? 'loading',
  )
}

/**
 * Opens a story and waits until its render and play function have ended and stayed ended for
 * 300 ms: a story can render again once its parameters apply (the pseudo-states addon does).
 */
async function openStory(page: Page, id: string, theme: string) {
  await page.goto(`${storybook}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`)
  const deadline = Date.now() + 30_000
  let stableSince = 0
  let phase = await phaseOf(page)
  while (Date.now() < deadline) {
    phase = await phaseOf(page)
    if (!settled.has(phase)) stableSince = 0
    else if (stableSince === 0) stableSince = Date.now()
    else if (Date.now() - stableSince >= 300) break
    await page.waitForTimeout(50)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  )
  return {
    phase,
    // Storybook's own error display, or the router's error screen around a part that threw
    // (RouterFrame), which Storybook counts as rendered.
    error: await page.evaluate(() =>
      document.body.classList.contains('sb-show-errordisplay')
        ? `${document.querySelector('#error-message')?.textContent ?? 'error'} ${document.querySelector('#error-stack')?.textContent ?? ''}`
        : document
              .querySelector('#storybook-root')
              ?.textContent?.startsWith('Something went wrong!')
          ? 'The router showed its error screen'
          : null,
    ),
  }
}

/**
 * The time one story may take: at a one-minute load near 70 (October 2026), 92 stories took 15
 * seconds on average and 41 at most. A test of many stories gets this for each of them, so its
 * budget grows with the stories added and a slow story borrows from the quick ones.
 */
const storyBudget = 45_000

/** Each story renders, its play function finishes, and axe finds nothing, overlays included. */
async function checkStories(page: Page, stories: Entry[], theme: string) {
  test.setTimeout(test.info().timeout + stories.length * storyBudget)
  for (const story of stories) {
    // The viewport global only sizes the manager's frame; a phone story gets a phone window.
    const phone = /^Phone/.test(story.name)
    const laptop = /^Laptop/.test(story.name)
    await page.setViewportSize(
      phone
        ? { width: 390, height: 844 }
        : laptop
          ? { width: 1024, height: 768 }
          : { width: 1440, height: 900 },
    )
    const result = await openStory(page, story.id, theme)
    expect.soft(result, `${story.title} / ${story.name} renders and plays`).toEqual({
      phase: 'finished',
      error: null,
    })
    const axe = await new AxeBuilder({ page })
      .include('#storybook-root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    // Overlays render outside the story root, so check them too when one is open.
    const overlays = await page
      .locator('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')
      .count()
    const portal = overlays
      ? await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      : axe
    const violations = [...axe.violations, ...portal.violations].map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
    )
    expect
      .soft([...new Set(violations)], `${story.title} / ${story.name} has no axe violations`)
      .toEqual([])
  }
}

for (const theme of themes) {
  test(`item page and Details stories render and pass axe, ${theme}`, async ({ page }) => {
    const stories = await storiesWhere(
      page,
      (entry) => entry.title === 'Library/Item page' || entry.title === 'Page/Details list',
    )
    expect(stories.length).toBeGreaterThanOrEqual(20)
    await checkStories(page, stories, theme)
  })

  test(`form kit stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await formStories(page)
    expect(stories.length).toBeGreaterThan(30)
    await checkStories(page, stories, theme)
  })

  test(`library action bar stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await barStories(page)
    expect(stories.length).toBeGreaterThanOrEqual(10)
    await checkStories(page, stories, theme)
  })

  test(`Bin and empty library stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await binStories(page)
    expect(stories.length).toBe(11)
    await checkStories(page, stories, theme)
  })

  test(`Mine's draft stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await draftStories(page)
    expect(stories.length).toBe(3)
    await checkStories(page, stories, theme)
  })

  test(`gaps stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await gapStories(page)
    // An owner's states moved to the Health stories (the Workbench's then) with slice W8.
    expect(stories.length).toBeGreaterThanOrEqual(13)
    await checkStories(page, stories, theme)
  })

  test(`release stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await releaseStories(page)
    expect(stories.length).toBeGreaterThanOrEqual(15)
    await checkStories(page, stories, theme)
  })

  test(`gateway stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await gatewayStories(page)
    expect(stories.length).toBeGreaterThanOrEqual(10)
    await checkStories(page, stories, theme)
  })

  test(`review stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await reviewStories(page)
    expect(stories.length).toBeGreaterThanOrEqual(20)
    await checkStories(page, stories, theme)
  })

  test(`draft checks stories play and pass axe, ${theme}`, async ({ page }) => {
    const stories = await draftChecksStories(page)
    expect(stories).toHaveLength(1)
    await checkStories(page, stories, theme)
  })

  test(`page rail stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await railStories(page)
    expect(stories.length).toBe(5)
    await checkStories(page, stories, theme)
  })

  test(`about field stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await aboutFieldStories(page)
    expect(stories.length).toBe(4)
    await checkStories(page, stories, theme)
  })

  test(`dock panel stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await dockStories(page)
    expect(stories.length).toBe(31)
    await checkStories(page, stories, theme)
  })

  test(`notification stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await notificationStories(page)
    expect(stories.length).toBeGreaterThanOrEqual(13)
    await checkStories(page, stories, theme)
  })

  test(`Heed marks and long domain names stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await markStories(page)
    expect(stories.map((story) => story.name).sort()).toEqual([
      'Heed Marks',
      'Kinds',
      'Long Domain Names',
      'Statuses',
    ])
    await checkStories(page, stories, theme)
  })

  test(`Home stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await homeStories(page)
    expect(stories.length).toBe(25)
    await checkStories(page, stories, theme)
  })

  test(`Docs stories play and pass axe, ${theme}`, async ({ page }) => {
    const stories = await docsStories(page)
    expect(stories.length).toBe(9)
    await checkStories(page, stories, theme)
  })

  test(`Help link stories play and pass axe, ${theme}`, async ({ page }) => {
    const stories = await helpStories(page)
    expect(stories.length).toBe(7)
    await checkStories(page, stories, theme)
  })

  test(`Health stories play and pass axe, ${theme}`, async ({ page }) => {
    // 59 stories in one test: on a busy machine they take more than five minutes.
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await healthStories(page)
    expect(stories.length).toBe(59)
    await checkStories(page, stories, theme)
  })

  test(`search size, rail avatar and Also mentioned stories play and pass axe, ${theme}`, async ({
    page,
  }) => {
    const stories = await fitStories(page)
    expect(stories.map((story) => story.name).sort()).toEqual([
      'Context Tab Also Mentioned',
      'Input Sizes',
      'Laptop Rail',
    ])
    await checkStories(page, stories, theme)
  })

  test(`chip preview stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await previewStories(page)
    expect(stories.length).toBe(6)
    await checkStories(page, stories, theme)
  })

  test(`Try it stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await tryItStories(page)
    expect(stories.length).toBe(16)
    await checkStories(page, stories, theme)
  })

  test(`Settings and Administration stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await settingsStories(page)
    expect(stories.length).toBe(48)
    await checkStories(page, stories, theme)
  })

  test(`Ask stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await askStories(page)
    expect(stories.length).toBe(35)
    await checkStories(page, stories, theme)
  })

  test(`agent change stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await agentChangeStories(page)
    expect(stories.length).toBe(11)
    await checkStories(page, stories, theme)
  })

  test(`answer formatting stories play and pass axe, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const stories = await answerStories(page)
    expect(stories.length).toBe(13)
    await checkStories(page, stories, theme)
  })

  test(`sign-in stories play and pass axe, ${theme}`, async ({ page }) => {
    const stories = await signInStories(page)
    expect(stories.length).toBe(13)
    await checkStories(page, stories, theme)
  })
}
