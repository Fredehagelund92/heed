import { devices, expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J17, the review on a phone: the decision bar says the state in words and where you are, its
// actions are 44px, and nothing you can press is under 44px.

test.use({ ...devices["iPhone 13"], browserName: "chromium" })

test("the bar says the state and the place, with full-size actions", async ({ page }) => {
  await go(page, "/inbox/sug-agent/review")
  const publish = page.getByRole("button", { name: "Publish anyway" }).last()
  await expect(publish).toBeVisible()
  await expect(page.getByText("2 claims to check").last()).toBeVisible()
  await expect(page.getByText("8 of 12").last()).toBeVisible()
  expect((await publish.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole("button", { name: "Next suggestion" }).click()
  await expect(page).toHaveURL(/sug-sofia-clash/)
})

test("no control is under 44px", async ({ page }) => {
  for (const route of ["/inbox/sug-lars-retire/review", "/inbox/sug-ines-long/review", "/inbox?card=sug-agent"]) {
    await go(page, route)
    await page.waitForTimeout(400)
    type Target = { getAttribute(n: string): string | null; textContent: string | null; getBoundingClientRect(): { width: number; height: number } }
    const small = await page.locator("button, a[href], input").evaluateAll((els: Target[]) =>
      els
        .filter((e) => !e.textContent?.includes("Skip to the content"))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
        .map(({ e, r }) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    )
    expect(small, route).toEqual([])
  }
})
