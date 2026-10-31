import { expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J36, the conflict view: two items an owner said disagree, side by side with where each comes
// from, and five ways to settle it. Every choice asks why and shows what agents will then say;
// the outcome stays in place with Undo. Someone who owns one side sees which buttons cannot act and
// why. The same view sits in the dock, on its own page, and in compact form in Ask, the review, the
// Inbox, Quality and the item page.

const norway = "itm_gift_store_credit.itm_gift_card_only"

test("from Ask: compare, keep one with a reason, see what agents now say, and undo", async ({ page }) => {
  await go(page, "/ask?example=conflict")
  const pair = page.getByRole("group", { name: "The two items" })
  await expect(pair).toContainText("Norway orders count store credit")
  await expect(page.getByText("These two disagree").first()).toBeVisible()
  await page.getByRole("button", { name: "Compare and decide" }).click()
  await expect(page).toHaveURL(new RegExp(`dock=conflict\\.${norway}`))
  await expect(page.getByRole("heading", { name: "Two items say different things about Orders in Norway." })).toBeVisible()
  // Grey words come with a legend and, for a screen reader, the words in both.
  await expect(page.getByText("are in both. The words in full ink are where they part.")).toBeVisible()
  await expect(page.getByTestId("dock-720").getByText("Words in both: Orders in Norway; store credit and gift cards.", { exact: true })).toBeAttached()

  // Keep the second one: the box needs a reason before it can act.
  await page.keyboard.press("2")
  const box = page.getByRole("dialog", { name: "Keep “Norway orders are card and cash payments only”" })
  await expect(box.getByText("Agents will then say")).toBeVisible()
  await expect(box.getByRole("button", { name: "Keep this one" })).toBeDisabled()
  await box.getByLabel("Why does this one stay?").fill("The finance memo of 2 Oct replaced the old definition.")
  await box.getByLabel("A line that settles it").fill("Norway order value is taken from card and cash settlements.")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(box).toBeHidden()
  const outcome = page.getByRole("status").filter({ hasText: "Archived “Norway orders count store credit”" })
  await expect(outcome).toContainText("Agents now say")
  await expect(outcome).toContainText("Reason: The finance memo of 2 Oct replaced the old definition.")
  await outcome.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByRole("heading", { name: "Two items say different things about Orders in Norway." })).toBeVisible()
})

test("Esc closes the reason box and keeps what was written", async ({ page }) => {
  await go(page, `/context/conflicts/${norway}`)
  await page.getByRole("button", { name: "Keep both" }).click()
  const box = page.getByRole("dialog", { name: "Keep both" })
  await box.getByLabel("Why do both stay?").fill("Both hold until Finance rules on it.")
  await page.keyboard.press("Escape")
  await expect(box).toBeHidden()
  await page.keyboard.press("b")
  await expect(page.getByRole("dialog", { name: "Keep both" }).getByLabel("Why do both stay?")).toHaveValue("Both hold until Finance rules on it.")
})

test("keep both: agents keep saying Conflict, and the pair leaves the list until either changes", async ({ page }) => {
  await go(page, "/context/conflicts")
  await expect(page.getByRole("radio", { name: /Conflicts/ })).toContainText("3")
  await page.getByRole("link", { name: "Orders in Norway" }).click()
  await page.getByRole("button", { name: "Keep both" }).click()
  const box = page.getByRole("dialog", { name: "Keep both" })
  await expect(box.getByText("Agents will then say")).toBeVisible()
  await expect(box).toContainText("Conflict")
  await box.getByLabel("Why do both stay?").fill("Both hold until Finance rules on it.")
  await box.getByRole("button", { name: "Keep both" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Kept both. Agents keep saying Conflict" })).toBeVisible()
  await go(page, "/context/conflicts?whose=all")
  await expect(page.getByRole("radio", { name: /Conflicts/ })).toContainText("2")
  await expect(page.getByRole("link", { name: "Orders in Norway" })).toHaveCount(0)
})

test("not a conflict removes the flag; the item page and the list say so", async ({ page }) => {
  await go(page, "/context/itm_gift_store_credit")
  await expect(page.getByRole("heading", { name: "Disagrees with" })).toBeVisible()
  await page.getByRole("button", { name: "Compare and decide" }).click()
  await page.getByRole("button", { name: "Not a conflict" }).click()
  const box = page.getByRole("dialog", { name: "Not a conflict" })
  await expect(box).toContainText("Agents then give both and say nothing about a difference.")
  await box.getByLabel("Why is this not a conflict?").fill("They apply to different weeks.")
  await box.getByRole("button", { name: "Not a conflict" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Not a conflict. The flag is removed" })).toBeVisible()
  await go(page, "/context/itm_gift_store_credit")
  await expect(page.getByRole("heading", { name: "Disagrees with" })).toHaveCount(0)
})

test("across two domains: what one owner cannot do says why, and asks the other owner", async ({ page }) => {
  await go(page, "/context/conflicts/itm_spain_vat_in.itm_spain_vat_out?as=Sofia%20Brandt")
  await expect(page.getByText("Yours")).toBeVisible()
  await expect(page.getByText("Owned by Paid media")).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep this one" }).first()).toBeDisabled()
  await expect(page.getByText("Archives the Paid media item. Only Priya Nair or an admin can do that.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Suggest archiving this one" })).toBeVisible()
  await expect(page.getByText("You own Sales. Priya Nair owns Paid media.")).toBeVisible()
  await page.getByRole("button", { name: "Ask Priya Nair" }).click()
  const ask = page.getByRole("dialog", { name: "Ask Priya Nair" })
  await ask.getByLabel("Your question").fill("Which one should agents get?")
  await ask.getByRole("button", { name: "Ask Priya Nair" }).click()
  await expect(page.getByText("Asked Priya Nair")).toBeVisible()
})

test("near copies are underlined where they differ; a long list shows six and the rest on request", async ({ page }) => {
  await go(page, "/context/conflicts/itm_france_switch_12.itm_france_switch_21")
  await expect(page.getByText("are where the two differ.")).toBeVisible()
  await expect(page.locator('mark[data-mark="differs"]').first()).toHaveText("[differs: 12]")
  await go(page, "/context/conflicts?state=many&whose=all")
  await expect(page.getByRole("row")).toHaveCount(7)
  await page.getByRole("button", { name: /^Show 8 more/ }).click()
  await expect(page.getByRole("row")).toHaveCount(15)
})

test("the review: each overlap side by side, the one that shares no words folded, Publish waits for every answer", async ({ page }) => {
  await go(page, "/inbox/sug-sofia-clash/review")
  await expect(page.getByText("2 of 3 say something about the same thing. Answer for each.")).toBeVisible()
  await expect(page.getByText("1 more overlaps only by where it applies")).toBeVisible()
  const decide = page.getByRole("complementary", { name: "Try it and decide" })
  await expect(decide.getByText("0 of 3 answered.")).toBeVisible()
  await page.getByRole("radiogroup", { name: "How does it relate to Norway orders count store credit?" }).getByRole("radio", { name: "These disagree" }).click()
  await page.getByRole("radiogroup", { name: "How does it relate to Norway orders are card and cash payments only?" }).getByRole("radio", { name: "This replaces it" }).click()
  await expect(decide.getByText("2 of 3 answered.")).toBeVisible()
  await page.getByRole("button", { name: "Mark it unrelated" }).click()
  await expect(page.getByText("Marked unrelated")).toBeVisible()
  await expect(decide.getByRole("button", { name: "Publish" })).toBeEnabled()
})

test("the Inbox alert and Quality lead to the comparison", async ({ page }) => {
  await go(page, "/inbox?card=alert-orders-norway")
  await expect(page.getByRole("group", { name: "The two items" })).toBeVisible()
  await page.getByRole("button", { name: "Compare and decide" }).click()
  await expect(page).toHaveURL(new RegExp(`dock=conflict\\.${norway}`))
  await go(page, "/observability/quality")
  const look = page.getByRole("region", { name: "Needs a look" })
  await expect(look.getByText("Keep the new answer saves the conflict as the answer to expect. It does not settle it.")).toBeVisible()
  await look.getByRole("button", { name: "Compare and decide" }).click()
  await expect(page).toHaveURL(new RegExp(`dock=conflict\\.${norway}`))
})

test("failures keep what was written; a change while reading holds the buttons", async ({ page }) => {
  await go(page, `/context/conflicts/${norway}?state=failed`)
  await expect(page.getByText("Couldn't load the two items.")).toBeVisible()
  await go(page, `/context/conflicts/${norway}?state=refused`)
  await page.getByRole("button", { name: "Keep both" }).click()
  const box = page.getByRole("dialog", { name: "Keep both" })
  await box.getByLabel("Why do both stay?").fill("Both hold until Finance rules on it.")
  await box.getByRole("button", { name: "Keep both" }).click()
  await expect(box.getByText("Could not keep both. Nothing changed.")).toBeVisible()
  await expect(box.getByLabel("Why do both stay?")).toHaveValue("Both hold until Finance rules on it.")
  await page.keyboard.press("Escape")
  await go(page, `/context/conflicts/${norway}?state=changed`)
  await expect(page.getByText("The buttons are held until you have seen what changed.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep both" })).toBeDisabled()
  await page.getByRole("button", { name: "Show what changed" }).click()
  await expect(page.getByRole("button", { name: "Keep both" })).toBeEnabled()
  // A new install has nothing that disagrees, and says what that means.
  await go(page, "/context/conflicts?demo=setup")
  await expect(page.getByText("Nothing disagrees")).toBeVisible()
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test("one pile per item, no sideways scroll, and Settle it opens the six choices", async ({ page }) => {
    await go(page, `/context/conflicts/${norway}`)
    await expect(page.getByRole("region", { name: /^First item/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole("button", { name: "Settle it" }).click()
    const sheet = page.getByRole("dialog", { name: "Settle it" })
    for (const name of ["Keep “Norway orders count store credit”", "Edit one of them", "Keep both", "Not a conflict", "Ask the owner"])
      await expect(sheet.getByRole("button", { name })).toBeVisible()
  })
})
