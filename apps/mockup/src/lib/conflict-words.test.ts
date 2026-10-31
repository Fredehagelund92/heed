import { describe, expect, it } from "vitest"
import { comparePair, differingWords, sharedRuns } from "@/lib/conflict-words"

const A = "Orders in Norway include orders paid with store credit and gift cards, in euros at the daily rate."
const B = "Orders in Norway count only card and cash payments. Store credit and gift cards are left out."
const text = (runs: { text: string }[]) => runs.map((r) => r.text).join("")

describe("the words of a conflict", () => {
  it("finds no differing words in two statements written apart", () => {
    expect(differingWords(A, B)).toBeNull()
    expect(differingWords(B, A)).toBeNull()
  })

  it("greys the stretches both statements share, and keeps the text whole", () => {
    const a = sharedRuns(A, B)!
    expect(text(a)).toBe(A)
    expect(a.filter((r) => r.shared).map((r) => r.text)).toEqual(["Orders in Norway", "store credit and gift cards"])
    const b = sharedRuns(B, A)!
    expect(b.filter((r) => r.shared).map((r) => r.text)).toEqual(["Orders in Norway", "Store credit and gift cards"])
  })

  it("never greys one shared word on its own", () => {
    expect(sharedRuns("Count orders and returns.", "Leave out cash and cards.")).toBeNull()
  })

  it("marks a near copy where it differs, in at most three places", () => {
    const a = differingWords("Payment provider switched in France on 12 May 2026.", "Payment provider switched in France on 21 May 2026.")!
    expect(a.filter((r) => r.differs).map((r) => r.text)).toEqual(["12"])
    expect(differingWords("a b c d e f g h", "a x c y e z g w")).toBeNull()
  })

  it("reads both sides the same way, or says plainly that nothing is marked", () => {
    const [a, b] = comparePair(A, B)
    expect([a.how, b.how]).toEqual(["shared", "shared"])
    expect(a.inBoth).toEqual(["Orders in Norway", "store credit and gift cards"])
    const [x, y] = comparePair("Net revenue in Spain includes VAT.", "Net revenue in Spain excludes VAT.")
    expect([x.how, y.how]).toEqual(["differs", "differs"])
    expect(x.runs.find((r) => r.differs)?.text).toBe("includes")
    const [p, q] = comparePair("Refunds wait for the bank.", "Store returns count on booking.")
    expect([p.how, q.how]).toEqual(["plain", "plain"])
  })

  it("leaves identical texts unmarked", () => {
    expect(differingWords(A, A)).toBeNull()
    expect(sharedRuns(A, A)).toBeNull()
  })
})
