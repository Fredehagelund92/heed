import { expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J22, help: one Help row opens a small menu; ? opens the keys from anywhere; the Help page has the
// answer lines, words and how agents use it, and sends a "how do I" to the documentation, which is
// its own site; the answer line explains itself; Report a problem is one box.

test("one Help row opens the menu; Documentation lives in it", async ({ page }) => {
  await go(page, "/inbox")
  const sidebar = page.locator("[data-sidebar=sidebar]").first()
  await expect(sidebar.getByRole("link", { name: /Documentation/ })).toHaveCount(0)
  await sidebar.getByRole("button", { name: "Help" }).click()
  const menu = page.getByRole("menu")
  for (const row of ["Answer lines and words", "Keyboard shortcuts", "Documentation", "What's new", "Contact support", "Report a problem"])
    await expect(menu.getByRole("menuitem", { name: new RegExp(row) })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: /Get started/ })).toHaveCount(0)
  await menu.getByRole("menuitem", { name: "Answer lines and words" }).click()
  await expect(page).toHaveURL(/#\/help/)
})

test("Get started shows in the menu while setup is unfinished", async ({ page }) => {
  await go(page, "/inbox?demo=setup")
  await page.locator("[data-sidebar=sidebar]").first().getByRole("button", { name: "Help" }).click()
  await expect(page.getByRole("menuitem", { name: /Get started/ })).toContainText("0 of 5")
})

test("? opens the keys from anywhere, and once in the review", async ({ page }) => {
  await go(page, "/inbox")
  await page.keyboard.press("?")
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Search, or go anywhere")
  await page.keyboard.press("Escape")
  await go(page, "/inbox/sug-ines-link/review")
  await expect(page.getByRole("complementary", { name: "Try it and decide" }).getByRole("button", { name: "Publish", exact: true })).toBeVisible()
  await page.keyboard.press("?")
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(1)
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Close the note, keeping it")
})

test("the Help page searches its own words, and sends the rest to the documentation", async ({ page }) => {
  await go(page, "/help")
  await expect(page.getByRole("table", { name: "Answer lines" })).toContainText("Checked")
  await page.getByRole("searchbox", { name: "Search help" }).fill("synonym")
  await expect(page.getByText("Another name for a metric or a dimension")).toBeVisible()
  await page.getByRole("searchbox", { name: "Search help" }).fill("refund")
  await expect(page.getByText("Nothing in Help matches “refund”")).toBeVisible()
  await expect(page.getByRole("link", { name: /Search the documentation/ }).first()).toHaveAttribute("href", "#/docs?q=refund")
})

test("the answer line explains itself", async ({ page }) => {
  await go(page, "/ask?example=missing")
  await page.getByRole("button", { name: /^Not found\W+Nothing is written about this yet\.$/ }).click()
  await expect(page.getByText("What you do.")).toBeVisible()
  await expect(page.getByRole("link", { name: /All answer lines/ })).toHaveAttribute("href", "#/help")
})

test("Report a problem is one box", async ({ page }) => {
  await go(page, "/inbox?open=report")
  const dialog = page.getByRole("dialog", { name: "Report a problem" })
  await dialog.getByRole("textbox", { name: "What happened" }).fill("The review jumped to another item.")
  await dialog.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Support will reply by email.")).toBeVisible()
})

test("the documentation is its own site, with the app's prompt and an index for agents", async ({ page }) => {
  await go(page, "/docs/connect-an-agent")
  await expect(page.locator("[data-sidebar=sidebar]")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1, name: "Connect an agent" })).toBeVisible()
  await expect(page.locator("pre").first()).toContainText("claude mcp add --transport http")
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible()
  await go(page, "/docs/llms.txt")
  await expect(page.locator("pre")).toContainText("- [Privacy](/docs/privacy)")
})
