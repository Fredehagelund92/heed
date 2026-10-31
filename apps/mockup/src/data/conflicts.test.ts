import { describe, expect, it } from "vitest"
import { conflictPairs, keptBoth, pairAt, rightsOf, saidWithoutFlag, stampOf, sublineOf, titleOf, topicOf } from "@/data/conflicts"
import { facts, person, type Fact } from "@/data/world"
import { CONFLICT_KEYS } from "@/lib/conflict"

const norway = "itm_gift_store_credit.itm_gift_card_only"
const spain = "itm_spain_vat_in.itm_spain_vat_out"

describe("conflicts", () => {
  it("are the pairs an owner linked, each once, holder first, most asked first", () => {
    const pairs = conflictPairs(facts)
    expect(pairs.map((p) => p.key)).toEqual([norway, spain, "itm_france_switch_12.itm_france_switch_21"])
    // Either order of the address finds the same pair, with the holder first.
    expect(pairAt(facts, "itm_gift_card_only.itm_gift_store_credit")?.key).toBe(norway)
  })

  it("leave the lists when either item is archived", () => {
    const archived = facts.map((f) => (f.id === "itm_gift_card_only" ? { ...f, status: "Archived" as const } : f))
    expect(pairAt(archived, norway)).toBeUndefined()
  })

  it("say what they are about from structure, never from the words", () => {
    const p = pairAt(facts, norway)!
    expect(titleOf(p)).toBe("Two items say different things about Orders in Norway.")
    expect(sublineOf(p)).toBe("Both apply to Orders, Norway. Agents get both and say that context disagrees. Nothing is archived until an owner chooses.")
    expect(sublineOf(pairAt(facts, spain)!)).toContain("from 1 Jan 2026")
    expect(topicOf({ where: ["Orders"] } as Fact, { where: ["Orders"] } as Fact).topic).toBe("Orders")
    expect(saidWithoutFlag(p).state).toBe("grounded")
  })

  it("let each person do what the item it changes allows", () => {
    const p = pairAt(facts, spain)!
    const [sales, paid] = [p.holder, p.other]
    // [person, keep sales (archives paid), keep paid (archives sales), edit sales, edit paid, keep both, not a conflict]
    const table: [string, boolean, boolean, boolean, boolean, boolean, boolean][] = [
      ["Jon Abara", true, true, true, true, true, true], // admin
      ["Ravi Kapoor", true, true, true, true, true, true], // admin, owns nothing
      ["Sofia Brandt", false, true, true, false, true, true], // owns Sales, which holds the link
      ["Priya Nair", true, false, false, true, true, false], // owns Paid media, not the holder
      ["Ines Duarte", false, false, false, false, false, false], // owns nothing: asks the owner
    ]
    for (const [name, keepSales, keepPaid, editSales, editPaid, both, notConflict] of table) {
      const r = rightsOf(person(name), p)
      expect([r.keep(sales, paid), r.keep(paid, sales), r.edit(sales), r.edit(paid), r.both, r.notConflict], name).toEqual([
        keepSales,
        keepPaid,
        editSales,
        editPaid,
        both,
        notConflict,
      ])
    }
  })

  it("keep both lasts only until either item changes", () => {
    const p = pairAt(facts, norway)!
    const s = { how: "both" as const, reason: "Both hold for now.", by: "Jon Abara", at: "10:40", seen: { [p.holder.id]: stampOf(p.holder), [p.other.id]: stampOf(p.other) } }
    expect(keptBoth(p, s)).toBe(true)
    const edited = pairAt(
      facts.map((f) => (f.id === p.other.id ? { ...f, summary: `${f.summary} From 1 November 2026.` } : f)),
      norway
    )!
    expect(keptBoth(edited, s)).toBe(false)
  })

  it("never let two commands of the Conflict scope claim one key", () => {
    const keys = CONFLICT_KEYS.map((k) => k.key.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })
})
