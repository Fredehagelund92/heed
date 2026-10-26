import { expect, test } from "@playwright/test"
import { go, signInAs } from "./go.ts"

// J10, people: an admin invites people as owners of a domain, and the domain sees them; the last
// owner of a domain can't leave until someone takes over; an owner who isn't an admin can add
// owners to their own domain and nothing else; ownership is the same on both pages.

test("invited people show as pending, and as owners on their domain", async ({ page }) => {
  await go(page, "/settings/people")
  await page.getByRole("button", { name: "Invite people" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email addresses").fill("nina@larchwood.example, omar@larchwood.example")
  await dialog.getByRole("button", { name: "Marketing" }).click()
  await dialog.getByRole("button", { name: "Invite 2 people" }).click()
  await expect(page.getByRole("list", { name: "Invited" }).getByText("nina@larchwood.example").first()).toBeVisible()
  await go(page, "/settings/domains/marketing")
  await expect(page.getByRole("button", { name: /Owners/ })).toContainText("nina@larchwood.example")
})

test("the only owner of a domain hands over before leaving", async ({ page }) => {
  await go(page, "/settings/people")
  await page
    .getByRole("list", { name: "People" })
    .getByRole("button", { name: /Priya Nair/ })
    .click()
  await page.getByRole("button", { name: "Remove from the workspace" }).click()
  await expect(page.getByRole("dialog", { name: "Hand over first" })).toContainText("only owner of Paid media")
})

test("an owner who isn't an admin adds owners to their own domain only", async ({ page }) => {
  await signInAs(page, "Tomas Eriksen")
  await go(page, "/settings/people")
  await expect(page.getByRole("button", { name: "Invite people" })).toBeDisabled()
  await go(page, "/settings/domains/sales")
  await expect(page.getByRole("button", { name: /Owners/ })).toHaveAttribute("aria-disabled", "true")
  await go(page, "/settings/domains/marketing")
  await expect(page.getByRole("button", { name: /Owners/ })).not.toHaveAttribute("aria-disabled", "true")
})

test("ownership is the same on the domain page and in People", async ({ page }) => {
  await go(page, "/settings/domains/sales")
  await page.getByRole("button", { name: /Owners/ }).click()
  await page.getByRole("option", { name: /Ines Duarte/ }).click()
  await page.keyboard.press("Escape")
  await go(page, "/settings/people")
  await expect(page.getByRole("list", { name: "People" }).getByRole("button", { name: /Ines Duarte/ })).toContainText("Sales")
})

test("Settings leads back to the app, not to the workspace's name", async ({ page }) => {
  await go(page, "/settings/people")
  const back = page.getByRole("link", { name: "Back to app" })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/#\/inbox/)
})
