import { describe, expect, it } from "vitest"
import { reviewFor } from "@/data/review"
import { savedCounts, savedQuestions } from "@/data/saved-questions"
import { afterPublish, checkDraft, draftLine, setSavesQuestion } from "@/lib/saved-check"

// The check against a draft: what the saved questions that answer from an item would get with it.
// Shown before Publish, stored after, and Undo takes it back.

describe("a draft's check", () => {
  it("marks a question Changed when the sentence moves and the state holds", () => {
    const c = checkDraft(reviewFor("sug-ines")!)!
    expect(c.results.map((x) => [x.q.id, x.result])).toEqual([["sq-test-accounts", "changed"]])
    expect(draftLine(c)).toBe("0 of 1 still answers the same. 1 changed.")
  })

  it("marks a question Needs a look when its item would be archived", () => {
    const c = checkDraft(reviewFor("sug-lars-retire")!)!
    expect(c.look).toBe(1)
    expect(draftLine(c)).toBe("0 of 1 still answers the same. 1 needs a look.")
  })

  it("has nothing to say about an item no saved question answers from", () => {
    expect(checkDraft(reviewFor("gap-spain")!)).toBeNull()
  })
})

describe("after a publish", () => {
  it("keeps a Changed answer as the new saved one, and Undo puts it back", () => {
    const before = savedCounts(savedQuestions())
    const undo = afterPublish(reviewFor("sug-ines")!, "Jon Abara", "itm_s90n5xps", "sales")!
    expect(savedQuestions().find((q) => q.id === "sq-test-accounts")?.why).toBe("This publish is its new saved answer.")
    undo()
    expect(savedCounts(savedQuestions())).toEqual(before)
  })

  it("saves a gap's question when the box is ticked, and not when it isn't", () => {
    const n = savedQuestions().length
    const undo = afterPublish(reviewFor("gap-spain")!, "Jon Abara", "itm_gap_spain", "sales")!
    expect(savedQuestions()).toHaveLength(n + 1)
    expect(savedQuestions()[0].question).toBe("What happened to Orders in Spain, October 2026?")
    undo()
    setSavesQuestion("gap-spain", false)
    expect(afterPublish(reviewFor("gap-spain")!, "Jon Abara", "itm_gap_spain", "sales")).toBeUndefined()
    setSavesQuestion("gap-spain", true)
  })
})
