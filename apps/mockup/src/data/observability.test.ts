import { describe, expect, it } from "vitest"
import {
  AGENT_CALLS,
  AGENTS,
  barsOf,
  SPEND,
  speedOf,
  TOOL_CALLS,
  daysOf,
  numbersOf,
  countChange,
  shareChange,
  publishesIn,
  shownCount,
  statusOf,
  topicsOf,
  TOPICS,
  total,
  found,
  rollUp,
} from "@/data/observability"
import { week } from "@/data/inbox"
import { savedCounts, savedQuestions } from "@/data/saved-questions"

// Observability's numbers: the last 7 days are the Inbox's own line, and every range, filter and
// page adds up the same way. Saved questions are counted from one list wherever they show.

describe("the last 7 days", () => {
  it("are the numbers the Inbox already says", () => {
    const n = numbersOf({ range: 7 })
    expect(n.asked).toBe(week.asked)
    expect(n.found).toBe(week.found)
    expect(n.nothing).toBe(week.nothing)
    // The checked share counts Checked answers only: 94 of 142, not the 117 that found something.
    expect(n.checked).toBe(94)
    expect(n.checkedShare).toBe(66)
    expect(n.counts).toEqual({ grounded: 94, partial: 12, conflict: 4, stale: 7, missing: 25 })
  })

  it("split into ten topics and five kinds of agent that add up to the same 142", () => {
    expect(TOPICS.reduce((n, t) => n + total(t.week), 0)).toBe(142)
    expect(TOPICS.reduce((n, t) => n + t.week.missing, 0)).toBe(25)
    expect(AGENTS.reduce((n, a) => n + a.week, 0)).toBe(142)
  })

  it("compare with the 7 days before", () => {
    const n = numbersOf({ range: 7 })
    expect(n.askedBefore).toBe(129)
    // +10%, +2 points checked, 3 points fewer not found: moves chance would make, so the same.
    expect(n.askedChange).toEqual({ direction: "same", by: 13, percent: 10 })
    expect(n.checkedChange).toEqual({ direction: "same", by: 2 })
    expect(n.nothingChange).toEqual({ direction: "same", by: -3 })
  })

  it("say up or down only beyond what chance would make, and compare a share only from 30 asked", () => {
    expect(countChange(600, 400)).toEqual({ direction: "up", by: 200 })
    expect(shareChange(450, 563, 300, 514)).toEqual({ direction: "up", by: 22 })
    expect(shareChange(20, 29, 10, 200)).toBeNull()
  })
})

describe("ranges and filters", () => {
  it("add up the same in the chart as in the numbers", () => {
    for (const range of [7, 30, 90] as const) {
      const n = numbersOf({ range })
      expect(barsOf({ range }).reduce((s, b) => s + total(b.counts), 0)).toBe(n.asked)
      expect(daysOf({ range })).toHaveLength(range)
    }
  })

  it("show a bar a day for 7 and 30 days, a week for 90", () => {
    expect(barsOf({ range: 7 })).toHaveLength(7)
    expect(barsOf({ range: 30 })).toHaveLength(30)
    expect(barsOf({ range: 90 })).toHaveLength(13)
  })

  it("narrow to a domain: its topics only, and a share of the days", () => {
    const sales = topicsOf({ range: 7, domain: "sales" })
    expect(sales.every((t) => t.domain === "sales")).toBe(true)
    expect(numbersOf({ range: 7, domain: "sales" }).asked).toBeLessThan(142)
  })

  it("marks a publish only when it falls in the range", () => {
    expect(publishesIn({ range: 7 }).map((p) => p.title)).toEqual(["Units sold excludes test accounts"])
    expect(publishesIn({ range: 90 }).length).toBeGreaterThan(1)
  })
})

describe("what a topic says", () => {
  it("leads a gap to its way forward in the Inbox", () => {
    const spain = topicsOf({ range: 7 }).find((t) => t.id === "orders-spain")!
    expect(statusOf(spain)).toEqual({ label: "Draft ready", tone: "gap", href: "#/inbox?card=gap-spain" })
    // Net revenue in Norway disagrees 3 times across its two months, so the grouped row says so.
    const revenue = rollUp(topicsOf({ range: 7 })).find((g) => g.name === "Net revenue in Norway")!
    expect(statusOf({ ...revenue.rows[0], counts: revenue.counts })?.label).toBe("Conflict")
  })

  it("never shows a count under 5 as a number", () => {
    expect(shownCount(3)).toBe("Fewer than 5")
    expect(shownCount(0)).toBe("0")
    expect(shownCount(1420)).toBe("1,420")
  })

  it("counts found as everything that rests on something written down", () => {
    expect(found({ grounded: 1, partial: 1, conflict: 1, stale: 1, missing: 9 })).toBe(4)
  })
})

describe("saved questions, one list for every count", () => {
  it("are 12 in 4 domains: 8 same, 1 changed, 3 need a look; Sales 7 = 3 + 1 + 3", () => {
    expect(savedCounts(savedQuestions())).toEqual({ total: 12, same: 8, changed: 1, look: 3, domains: 4 })
    expect(savedCounts(savedQuestions(), "sales")).toEqual({ total: 7, same: 3, changed: 1, look: 3, domains: 1 })
  })
})

describe("a filtered page", () => {
  it("adds up to the same as its topics", () => {
    for (const domain of ["sales", "marketing", "customer_value", "paid_media"] as const) {
      const topics = topicsOf({ range: 7, domain })
      expect(numbersOf({ range: 7, domain }).asked, domain).toBe(topics.reduce((n, t) => n + total(t.counts), 0))
      expect(numbersOf({ range: 7, domain }).nothing, domain).toBe(topics.reduce((n, t) => n + t.counts.missing, 0))
    }
  })
})

describe("usage", () => {
  it("counts the same calls by tool and by kind of agent", () => {
    const byTool = TOOL_CALLS.reduce((a, t) => a + t.calls, 0)
    expect(byTool).toBe(312)
    expect(AGENT_CALLS.reduce((a, t) => a + t.calls, 0)).toBe(byTool)
    for (const t of TOOL_CALLS) expect(t.answered + t.detail + t.nothing + t.failed).toBe(t.calls)
  })
  it("draws speed by day for 7 days and by week for longer", () => {
    expect(speedOf(7).labels).toHaveLength(7)
    expect(speedOf(7).labels.at(-1)).toBe("Thu 22")
    expect(speedOf(30).median).toHaveLength(5)
    expect(speedOf(90).p95).toHaveLength(13)
  })
  it("adds the spend up to the month's total", () => {
    expect(SPEND.parts.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(SPEND.total)
    expect(SPEND.limits[0].used).toBe(SPEND.total)
  })
})
