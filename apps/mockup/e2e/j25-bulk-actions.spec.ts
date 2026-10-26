import { expect, test, type Page } from "@playwright/test"
import { go, signInAs } from "./go.ts"

// J25: what a person does to many items at once, from one bar. Archive is the safe default, with
// Undo; only drafts are deleted, after a confirmation that names them; what someone can't change is
// left alone and said ("2 skipped: owned by Sales"); a partial failure offers Retry; offline, the
// changes wait; the Delete key opens the confirmation and never deletes by itself.

const boxes = (page: Page) => page.getByRole("checkbox", { name: /^Select (?!all)/ })
const bar = (page: Page, name = "Selected context") => page.getByRole("region", { name })
const titles = (page: Page) => page.locator("tbody [data-row-open]")

async function onlyDrafts(page: Page) {
  await page.getByRole("button", { name: /^Filter/ }).click()
  await page.getByRole("menuitemcheckbox", { name: /^Draft/ }).click()
  await page.keyboard.press("Escape")
}

test("Archive takes items away from agents, and Undo puts exactly them back", async ({ page }) => {
  await go(page, "/context")
  const first = await titles(page).nth(0).innerText()
  await boxes(page).nth(0).click()
  await boxes(page)
    .nth(2)
    .click({ modifiers: ["Shift"] })
  await bar(page)
    .getByRole("button", { name: /^Archive/ })
    .click()
  await expect(page.getByText("3 archived", { exact: true })).toBeVisible()
  await expect(titles(page).filter({ hasText: first })).toHaveCount(0)
  await expect(bar(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(titles(page).nth(0)).toHaveText(first)
})

test("Delete names the drafts it removes, keeps published items, and Settings records it", async ({ page }) => {
  await go(page, "/context")
  await onlyDrafts(page)
  await expect(titles(page)).toHaveCount(3)
  await page.getByRole("checkbox", { name: "Select all context shown" }).click()
  await bar(page)
    .getByRole("button", { name: /^Delete/ })
    .click()
  const confirm = page.getByRole("dialog", { name: "Delete 3 drafts?" })
  await expect(confirm.getByRole("list", { name: "To delete" }).getByRole("listitem")).toHaveCount(3)
  // Cancel has the focus: a slip of Enter deletes nothing.
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused()
  await confirm.getByRole("button", { name: "Delete 3 drafts" }).click()
  await expect(page.getByText("3 deleted", { exact: true })).toBeVisible()
  await expect(page.getByText("No context matches")).toBeVisible()

  await go(page, "/settings/advanced")
  await expect(page.getByText("Black Friday 2026 orders land in two weeks", { exact: true })).toBeVisible()
  // The History log has the change too.
  await expect(page.getByRole("table", { name: "History log" })).toContainText(/Deleted “.*” and 1 more/)
  await expect(page.getByText(/Deleted by Jon Abara, today/).first()).toBeVisible()
})

test("Published items are archived, not deleted: the confirmation offers Archive instead", async ({ page }) => {
  await go(page, "/context")
  await boxes(page).nth(0).click()
  await boxes(page)
    .nth(1)
    .click({ modifiers: ["Shift"] })
  await bar(page)
    .getByRole("button", { name: /^Delete/ })
    .click()
  const confirm = page.getByRole("dialog", { name: "Published items are archived, not deleted" })
  await expect(confirm.getByRole("button", { name: "Archive 2 items" })).toBeVisible()
  await confirm.getByRole("button", { name: "Archive 2 items" }).click()
  await expect(page.getByText("2 archived", { exact: true })).toBeVisible()
})

test("Delete or Backspace on a selection opens the confirmation and deletes nothing by itself", async ({ page }) => {
  await go(page, "/context")
  await onlyDrafts(page)
  await boxes(page).nth(0).click()
  await page.keyboard.press("Delete")
  const confirm = page.getByRole("dialog", { name: "Delete 1 draft?" })
  await expect(confirm).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(confirm).toHaveCount(0)
  await expect(titles(page)).toHaveCount(3)
})

test("What someone can't change is skipped and said, and stays ticked with the reasons", async ({ page }) => {
  await signInAs(page, "Tomas Eriksen")
  await go(page, "/context")
  await boxes(page).nth(0).click()
  await boxes(page)
    .nth(3)
    .click({ modifiers: ["Shift"] })
  // Nothing here is his: Archive says why before it is pressed.
  const archive = bar(page).getByRole("button", { name: /^Archive/ })
  await expect(archive).toHaveAttribute("aria-disabled", "true")
  await expect(archive).toHaveAccessibleDescription(/^Only owners of .* and admins can change these\.$/)
  // A range with one of his items: that one is archived, the rest are skipped and stay ticked.
  await page.keyboard.press("Escape")
  const all = await titles(page).allInnerTexts()
  // "New VAT rate applied in Norway" is Marketing's; the row before it is not.
  const at = all.findIndex((t) => t.includes("New VAT rate applied in Norway"))
  expect(at).toBeGreaterThan(0)
  await boxes(page)
    .nth(at - 1)
    .click()
  await boxes(page)
    .nth(at)
    .click({ modifiers: ["Shift"] })
  await bar(page)
    .getByRole("button", { name: /^Archive/ })
    .click()
  await expect(page.getByText("1 archived", { exact: true })).toBeVisible()
  await expect(page.getByText(/^1 skipped: owned by /).first()).toBeVisible()
  await expect(bar(page)).toContainText("1 selected")
})

test("A partial failure says what went through, keeps what failed, and Retry finishes it", async ({ page }) => {
  await go(page, "/context?bulk=fail")
  await boxes(page).nth(0).click()
  await boxes(page)
    .nth(3)
    .click({ modifiers: ["Shift"] })
  await bar(page)
    .getByRole("button", { name: /^Archive/ })
    .click()
  await expect(page.getByText("3 of 4 archived, 1 failed").first()).toBeVisible()
  await expect(bar(page)).toContainText("1 selected")
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("1 archived", { exact: true })).toBeVisible()
  await expect(bar(page)).toHaveCount(0)
})

test("Offline, changes are off with the reason, and export still works", async ({ page }) => {
  await go(page, "/context?state=offline")
  await boxes(page).nth(0).click()
  const archive = bar(page).getByRole("button", { name: /^Archive/ })
  await expect(archive).toHaveAttribute("aria-disabled", "true")
  await expect(archive).toHaveAccessibleDescription("Off while you're offline. Nothing is lost.")
  // A press does nothing: Playwright won't click a control that says it is disabled, so press it as a person would.
  await archive.dispatchEvent("click")
  await expect(bar(page)).toContainText("1 selected")
  await bar(page).getByRole("button", { name: /^More/ }).click()
  await page.getByRole("menuitem", { name: "Export" }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "As a spreadsheet (CSV)" }).click()
  expect((await download).suggestedFilename()).toBe("context.csv")
})

test("Mark as checked counts only the items that were opened", async ({ page }) => {
  await go(page, "/context")
  await titles(page).nth(1).click()
  await expect(page).toHaveURL(/dock=context\./)
  await page
    .getByRole("button", { name: /^Close/ })
    .last()
    .click()
  await boxes(page).nth(0).click()
  await boxes(page)
    .nth(1)
    .click({ modifiers: ["Shift"] })
  await bar(page).getByRole("button", { name: /^More/ }).click()
  await page.getByRole("menuitem", { name: /Mark as checked/ }).click()
  await expect(page.getByText("1 checked", { exact: true })).toBeVisible()
  await expect(page.getByText("1 skipped: not opened yet").first()).toBeVisible()
})

test("After Select all on the page, Select all N matching takes the folded rows too", async ({ page }) => {
  await go(page, "/context")
  await page.getByRole("button", { name: "Group" }).click()
  await page.getByRole("menuitemradio", { name: "Domain" }).click()
  await page.keyboard.press("Escape")
  await page.locator("tbody tr button[aria-expanded=true]").first().click()
  const shown = await boxes(page).count()
  await page.getByRole("checkbox", { name: "Select all context shown" }).click()
  await expect(bar(page)).toContainText(`${shown} selected`)
  const matching = bar(page).getByRole("button", { name: /^Select all \d+ matching$/ })
  const n = Number((await matching.innerText()).match(/\d+/)![0])
  expect(n).toBeGreaterThan(shown)
  await matching.click()
  await expect(bar(page)).toContainText(`${n} selected`)
})

test("Definitions change terms only: a synced metric is skipped, and a term takes its other names", async ({ page }) => {
  await go(page, "/definitions")
  const names = await page.locator("tbody [data-row-open]").allInnerTexts()
  const term = names.findIndex((t) => t.startsWith("Test account"))
  await boxes(page)
    .nth(term - 1)
    .click()
  await boxes(page)
    .nth(term)
    .click({ modifiers: ["Shift"] })
  await bar(page, "Selected definitions")
    .getByRole("button", { name: /^Delete/ })
    .click()
  const confirm = page.getByRole("dialog", { name: "Delete 1 term?" })
  await expect(confirm).toContainText("1 skipped: synced from Cube")
  await confirm.getByRole("button", { name: "Delete 1 term" }).click()
  await expect(page.getByText("1 term deleted")).toBeVisible()
  await expect(page.locator("tbody [data-row-open]").filter({ hasText: /^Test account$/ })).toHaveCount(0)
  await expect(bar(page, "Selected definitions")).toContainText("1 selected")
})

test("On a phone, Select starts picking and the bar runs along the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, "/context")
  await page.getByRole("button", { name: "Select", exact: true }).click()
  await page.locator("tbody tr").nth(1).click()
  await page.locator("tbody tr").nth(2).click()
  await expect(page).not.toHaveURL(/dock=/)
  const region = bar(page)
  await expect(region).toContainText("2 selected")
  // The bar slides up as it arrives: measured once it has settled.
  await expect
    .poll(async () => {
      const b = (await region.boundingBox())!
      return Math.round(b.y + b.height)
    })
    .toBe(844)
  expect(Math.round((await region.boundingBox())!.width)).toBe(390)
})
