import { expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J15, "Publish the ones you've read": opening and leaving is not reading. The whole change on
// screen for a few seconds, or Mark as read, is. Bulk publish lists what it publishes, and Undo
// puts all of them back. The Inbox's dot means not opened yet.

/**
 * Time stands still from the start and moves only in steps until the change is on screen, then only
 * by runFor: nothing counts by accident, however slow the machine. (Pausing after the change shows
 * leaves real time between the two, and on a loaded machine that was enough to count as read.)
 */
async function hold(page: import("@playwright/test").Page) {
  const line = page.getByText(/Counts as read after about \d+ seconds here./)
  while (!(await line.isVisible())) await page.clock.runFor(100)
}

const bulk = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Waiting suggestions" }).getByRole("button", { name: /publish/i })

test("opening and leaving does not count as read", async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, "/inbox/sug-ines-order/review")
  await hold(page)
  await page.clock.runFor(1000)
  await page.keyboard.press("j")
  await expect(page).toHaveURL(/sug-ines-long/)
  await page.clock.runFor(1000)
  await page.keyboard.press("j")
  await expect(page).toHaveURL(/sug-ines-dates/)
  await expect(bulk(page)).toHaveText("Read one to publish it")
})

test("a few seconds on the whole change counts; bulk lists them, and Undo restores all", async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, "/inbox/sug-ines-format/review")
  await hold(page)
  await page.clock.runFor(8000)
  await expect(page.getByText("Read. It can be published with the others you've read.")).toBeVisible()
  // The link change in between needs its own look: it is never part of the bulk.
  await page.keyboard.press("j")
  await expect(page).toHaveURL(/sug-ines-link/)
  await expect(page.getByRole("button", { name: "Mark as read" })).toHaveCount(0)
  await page.keyboard.press("j")
  await page.getByRole("button", { name: "Mark as read" }).click()
  await expect(bulk(page)).toHaveText("Publish the 2 you've read")
  await bulk(page).click()
  const confirm = page.getByRole("dialog", { name: "Publish the 2 you've read?" })
  await expect(confirm.getByRole("list", { name: "To publish" }).getByRole("listitem")).toHaveText([
    /Online sales to Norway stopped on 4 August 2026/,
    /What to rule out before explaining a jump in Gross margin/,
  ])
  await confirm.getByRole("button", { name: "Publish 2" }).click()
  await page.clock.runFor(700)
  await expect(page.getByText("Published 2")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Done / })).toHaveCount(2)
  await page.getByRole("button", { name: "Undo" }).click()
  await page.clock.runFor(500)
  await expect(page.getByRole("button", { name: /^Done / })).toHaveCount(0)
  await expect(page.getByText("Published, just now")).toHaveCount(0)
  await expect(page.getByText("Back: 2 waiting again")).toBeVisible()
  await expect(bulk(page)).toHaveText("Publish the 2 you've read")
})

test("the ones opened but not yet counted can be marked read at once", async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, "/inbox/sug-ines-order/review")
  await hold(page)
  await page.keyboard.press("j")
  await expect(page).toHaveURL(/sug-ines-long/)
  await page.getByRole("button", { name: "Mark the 2 I've opened as read" }).click()
  await expect(bulk(page)).toHaveText("Publish the 2 you've read")
})

test("the Inbox's dot goes once a card is opened", async ({ page }) => {
  await go(page, "/inbox?card=sug-ines-link")
  const row = page.locator('[data-row="sug-ines-link"]')
  await expect(row.getByLabel("Not opened yet")).toHaveCount(0)
  const other = page.locator('[data-row="sug-ines-order"]')
  await expect(other.getByLabel("Not opened yet")).toHaveCount(1)
  await go(page, "/inbox/sug-ines-order/review")
  // The change's heading, not the read line: that one goes once the change counts as read.
  await expect(page.locator("#change-heading")).toBeVisible()
  await go(page, "/inbox")
  await expect(other.getByLabel("Not opened yet")).toHaveCount(0)
})
