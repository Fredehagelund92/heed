import { expect, test } from "@playwright/test"
import { go } from "./go.ts"

// J11, figures in Ask: off by default, an answer links into the tool; an admin switches figures on
// for Cube and the answer shows one figure with its source and freshness; a figure that doesn't
// fit a context item shows both; a metric nobody defines gets no figure; the definition decides.

test("off by default, an answer links into the tool", async ({ page }) => {
  await go(page, "/ask?example=grounded")
  await expect(page.getByRole("link", { name: /See the figure in Cube: Orders in Norway, 1 to 31 Aug 2026/ })).toBeVisible()
})

test("switched on for Cube, the answer shows one figure, its source and its query in words", async ({ page }) => {
  await go(page, "/settings/integrations/cube")
  await page.getByRole("switch", { name: "Show figures in Ask" }).click()
  // A hash change is the same page, so the switch holds without a review flag.
  await go(page, "/ask?example=grounded")
  const log = page.getByRole("log")
  await expect(log.getByText("€43,600")).toBeVisible()
  await expect(log.getByText("From Cube, data as of today at 06:00.")).toBeVisible()
  await log.getByRole("button", { name: "Show the query" }).click()
  await expect(log.getByText(/added up for Norway from 1 to 31 Aug 2026/)).toBeVisible()
})

test("a figure that doesn't fit a context item shows both, and both routes", async ({ page }) => {
  await go(page, "/ask?example=figconflict&figures=on")
  const log = page.getByRole("log")
  await expect(log.getByText("The figure doesn't fit a context item.")).toBeVisible()
  await expect(log.getByRole("button", { name: "Tell the owner of Marketing" })).toBeVisible()
  await expect(log.getByRole("button", { name: /Tell Ravi Kapoor, the data contact/ })).toBeVisible()
})

test("a metric nobody defines gets no figure, and the definition decides the source", async ({ page }) => {
  await go(page, "/ask?example=nodata&figures=on")
  await expect(page.getByRole("log").getByText("No figure.")).toBeVisible()
  await go(page, "/ask?example=grounded&figures=warehouse")
  await expect(page.getByRole("link", { name: /See the figure in Cube/ })).toBeVisible()
})
