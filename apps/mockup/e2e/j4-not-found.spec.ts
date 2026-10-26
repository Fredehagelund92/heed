import { expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J4: what agents couldn't answer comes as a draft, reviewed and published like any suggestion.
test("a Not found card is a draft to review and publish", async ({ page }) => {
  await go(page, "/inbox?demo=week")
  await page.getByRole("button", { name: /Orders in Spain, October 2026/ }).click()
  await page.getByRole("button", { name: "Review", exact: true }).click()
  await expect(page.getByText("A draft to check.")).toBeVisible()
  await page.locator("#decision").getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.locator("#decision").getByRole("status")).toContainText("Published")
  await go(page, "/context/itm_spain_payments")
  await expect(page.getByRole("heading", { name: "Card payments in Spain failed from 14 to 16 October 2026" })).toBeVisible()
  // Its dates are in the folded Details row, summarised and in full once opened.
  const details = page.getByRole("button", { name: /^Details/ })
  await expect(details).toContainText("14 to 16 Oct 2026")
  await details.click()
  await expect(page.getByRole("definition").filter({ hasText: "14 to 16 Oct 2026" })).toBeVisible()
})
