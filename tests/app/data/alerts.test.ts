import { describe, expect, it } from "vitest"
import { lastOf, RAISED, RULES, rulesFor, setMuted, setRuleOn, setThreshold, thresholdOf, useAlerts } from "@/data/alerts"
import { cards } from "@/data/inbox"
import { savedCounts, savedQuestions } from "@/data/saved-questions"

// useAlerts is a hook; the store's state is read here through what the setters change.
void useAlerts

describe("alert rules", () => {
  it("has eight rules, four of them new, and owners see the four that reach owners plus the shared one", () => {
    expect(RULES).toHaveLength(8)
    expect(RULES.filter((r) => r.isNew)).toHaveLength(4)
    expect(rulesFor(true)).toHaveLength(8)
    expect(rulesFor(false).map((r) => r.id)).toEqual(["gap", "saved", "disagree", "sync", "due"])
  })
  it("fires the saved-question rule after a publish, an archive, a restore, a sync, or a check date passing", () => {
    expect(RULES.find((r) => r.id === "saved")!.when).toBe("After a publish, an archive, a restore, a sync, or a check date passing")
  })
  it("raises a card the Inbox has, counting what Quality counts", () => {
    const card = cards.find((c) => c.id === "look-sales")!
    expect(card.look!.questions).toHaveLength(savedCounts(savedQuestions()).look)
    expect(card.title).toBe(`${savedCounts(savedQuestions()).look} saved questions need a look`)
    for (const r of RAISED.filter((x) => x.href.startsWith("#/inbox?card="))) expect(cards.some((c) => r.href.endsWith(`=${c.id}`))).toBe(true)
  })
  it("shows an owner only their own domains' last raise", () => {
    const gap = RULES.find((r) => r.id === "gap")!
    expect(lastOf(gap, null).last).toBe("Today, Orders in Germany")
    expect(lastOf(gap, ["marketing"]).last).toBe("Never")
    expect(
      lastOf(
        RULES.find((r) => r.id === "due")!,
        ["marketing"]
      ).last
    ).toBe("Fri 18 Sep, 1 item")
  })
  it("keeps a changed threshold, and the setters can be taken back", () => {
    const gap = RULES.find((r) => r.id === "gap")!
    setThreshold("gap", "10")
    expect(thresholdOf(gap)).toBe("10")
    setThreshold("gap", "5")
    setRuleOn("spend", false)
    setRuleOn("spend", true)
    setMuted("gap", ["marketing"], true)
    setMuted("gap", ["marketing"], false)
    expect(thresholdOf(gap)).toBe("5")
  })
})
