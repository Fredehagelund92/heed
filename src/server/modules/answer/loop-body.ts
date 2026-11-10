import type {
  LoopBlock,
  LoopItem,
  LoopOverview,
  LoopRun,
  LoopTurn,
} from '../../../contract/answer.ts'
import { dimensionOf, nounKindOf } from '../../../domain/ask-nouns.ts'
import { isCalendarDate } from '../../../domain/validity.ts'

/*
  The answer's words as the page draws them (FR-720), written by code from what the model wrote
  and what the reads returned. The model writes each noun as a typed mention whose id a read
  returned (`[@metric:orders]`, `[@value:channel/web_shop]`), each count or day a read gave as a
  reference to it (`[#r1.count]`), cites items by id as before, asks for a read's items as a list
  (`[list:r1]`), and may write a short list as lines that start with "- ". Code checks every one
  against the reads of this chat: a mention no read named is plain words, never a chip; a
  reference no read holds leaves its sentence out; and what the check found is kept in `checks`,
  never shown as the answer's words. A set the person asked for as a whole is an overview: the
  groups of one read, by code.

  Nothing here knows a dimension, a domain or a person by name: the nouns come from the reads.
*/

/** One read of the chat as the words may cite it: its number (`r1`), its tool and its result. */
export type NumberedRead = { ref: string; tool: string; result: unknown }

type Obj = Record<string, unknown>
type Noun = LoopTurn['nouns'][number]
type Check = LoopTurn['checks'][number]
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const ITEM_ID = /^itm_[a-z0-9]{8,16}$/

/** The nouns the reads named, by id (each result's `names`), with each value's dimension too. */
export function nounsRead(results: readonly unknown[]): Map<string, Noun> {
  const nouns = new Map<string, Noun>()
  for (const r of results)
    for (const n of isObj(r) ? arr(r.names) : []) {
      const id = str(n.id)
      if (!id || !nounKindOf(id) || nouns.has(id)) continue
      const dimension = dimensionOf(id)
      const of = dimension && str(n.of) ? { id: dimension, name: str(n.of) } : null
      const type = typeof n.type === 'string' ? n.type : null
      nouns.set(id, { id, name: str(n.name) || id, of, type })
      if (of && !nouns.has(of.id)) nouns.set(of.id, { id: of.id, name: of.name, of: null, type })
    }
  return nouns
}

const statusOf = (words: string, outOfDate: unknown): LoopItem['status'] =>
  words === 'archived' ? 'archived' : words.startsWith('due') || outOfDate ? 'due' : 'live'

/** The reason the records give when an item is due because its check date passed (tool-records.ts). */
const DATE_PASSED = 'its check date passed'

/**
 * Why a row is due, in the read's own words: an item's `outOfDate`, or the records' `why`, with
 * the day only when the reason is that day passing ("its check date passed on 2 Oct 2026"). A due
 * row whose read gives no reason says none: a check date may still be ahead of an item whose
 * definition or source changed.
 */
function dueWords(o: Obj): string | null {
  if (typeof o.outOfDate === 'string') return o.outOfDate
  if (!str(o.status).startsWith('due')) return null
  const why = str(o.why)
  const day = str(o.checkDate)
  return why === DATE_PASSED && isCalendarDate(day) ? `${why} on ${shortDay(day)}` : why || null
}

/** The context items the reads returned, as a row shows each: the first read that gave it wins. */
export function itemRows(results: readonly unknown[]): Map<string, Omit<LoopItem, 'n'>> {
  const rows = new Map<string, Omit<LoopItem, 'n'>>()
  const add = (o: Obj) => {
    const id = str(o.id)
    if (!ITEM_ID.test(id) || rows.has(id)) return
    const checked = isObj(o.checked) ? str(o.checked.date) : str(o.lastChecked)
    rows.set(id, {
      id,
      title: str(o.title),
      kind: str(o.kind),
      domain: str(o.domainId) || null,
      about: strs(o.about),
      status: statusOf(str(o.status), o.outOfDate),
      checked: checked || null,
      outOfDate: dueWords(o),
    })
  }
  for (const r of results) {
    if (!isObj(r)) continue
    arr(r.items).forEach(add)
    if (isObj(r.item)) add(r.item)
    if (isObj(r.wider)) arr(r.wider.items).forEach(add)
    arr(r.nearby).forEach(add)
    for (const p of arr(r.pairs)) [p.holder, p.other].filter(isObj).forEach(add)
    if (isObj(r.groups)) for (const g of arr(r.groups.rows)) arr(g.items).forEach(add)
  }
  return rows
}

/** A day as the answer says it: "4 August 2026". */
export const dayWords = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** A day as a row says it, as the page writes every row's day: "4 Aug 2026", "2 Sep 2026". */
const shortDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${dayWords(day).split(' ')[1]?.slice(0, 3) ?? m} ${y}`
}

/** The plain words of runs: a noun by its name, a citation as [n], a count with what it is out of. */
export function runWords(runs: readonly LoopRun[], nouns: ReadonlyMap<string, Noun>): string {
  return runs
    .map((r) => {
      switch (r.t) {
        case 'text':
          return r.text
        case 'noun':
          return nouns.get(r.id)?.name ?? r.id
        case 'cite':
          return `[${r.n}]`
        case 'count':
          return r.of ? `${r.value} ${r.of}` : r.value
        case 'date':
          return dayWords(r.day)
      }
    })
    .join('')
}

/** What the words may name and cite, from the reads of this chat. */
export type WordsContext = {
  nouns: ReadonlyMap<string, Noun>
  /** Every id the reads returned: what a citation may be. */
  known: ReadonlySet<string>
  reads: readonly NumberedRead[]
  /** The digits in the reads, the question and the chat: a digit elsewhere is the model's own. */
  digits: ReadonlySet<string>
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>
}

/** The words written by the model, as checked blocks, with what they cite and what the check found. */
export type Words = {
  body: LoopBlock[]
  /** The items cited, in the order first cited: [n] is the nth. */
  cited: string[]
  checks: Check[]
}

/** A mention, a number reference, a list, a citation mark, or a bare item id. */
const TOKEN =
  /\[@([a-z]+:[^\]\s]{1,200})\]|\[#(r\d+)((?:\.[A-Za-z0-9_]+)+)\]|\[list:(r\d+)\]|\[([^[\]\n]{1,200})\]|\b(itm_[a-z0-9]{8,16})\b/g
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/
const LIST_LINE = /^\s*\[list:(r\d+)\]\s*$/
/** A sentence's end, with any marks after it: where one sentence stops and the next begins. */
const SENTENCE_END = /(?<=[.!?](?:\s*\[[^[\]\n]{1,200}\])*)\s+/

/**
 * An id's words when no read named it: the name of a noun a read named that the id spells
 * (`person:ada_okafor` for Ada Okafor), else its last part as words. Never a chip.
 */
const plainName = (id: string, nouns: ReadonlyMap<string, Noun>) => {
  const tail =
    id
      .slice(id.indexOf(':') + 1)
      .split('/')
      .at(-1) ?? id
  const words = tail.replace(/[_-]+/g, ' ').trim()
  const same = [...nouns.values()].find((n) => n.name.toLowerCase() === words.toLowerCase())
  return same?.name ?? words.charAt(0).toUpperCase() + words.slice(1)
}

/** A typed id as a read gives it, when the model wrote its kind twice (`domain:domain:area_x`). */
const typedId = (id: string) => id.replace(/^([a-z]+):\1:/, '$1:')

/** A name as words, not inside another word, in any case. */
const nameIn = (name: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'iu',
  )

/** A path into a read's result: `count`, `outOf`, `groups.rows.0.count`. */
function valueAt(result: unknown, path: readonly string[]): unknown {
  let at: unknown = result
  for (const part of path) {
    if (Array.isArray(at) && /^\d+$/.test(part)) at = at[Number(part)]
    else if (Array.isArray(at) && part === 'length') at = at.length
    else if (isObj(at) && Object.hasOwn(at, part)) at = at[part]
    else return undefined
  }
  return at
}

/** A read's value as a run: a count, a count with what it is out of, a floor ("13+") or a day. */
function numberRun(value: unknown): LoopRun | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return { t: 'count', value: value.toLocaleString('en-GB'), of: null }
  if (isObj(value) && typeof value.count === 'number' && typeof value.of === 'string')
    return { t: 'count', value: value.count.toLocaleString('en-GB'), of: value.of }
  if (typeof value === 'string' && /^\d[\d,]*\+?$/.test(value))
    return { t: 'count', value, of: null }
  if (typeof value === 'string' && isCalendarDate(value)) return { t: 'date', day: value }
  return null
}

const MONTHS =
  'January February March April May June July August September October November December'
    .split(' ')
    .map((m) => m.slice(0, 3))
/** A day in words or as a date ("2 October 2026", "19 May", "2026-10-02"); a month by its capital. */
const DAY = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\.?(?:,?\\s+(\\d{4}))?(?!\\d)|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`,
  'g',
)
/** A number in words, not a part of a word or of another number: "4", "1,240", "13+". */
const NUMBER = /(?<![\p{L}\p{N}_.,])\d(?:[\d,]*\d)?(?:\.\d+)?\+?/gu
const valueOf = (number: string) => Number(number.replace(/[,+]/g, ''))

/** The words of the clause so far, as the model wrote them: since the sentence's last , ; or : */
function clauseSoFar(runs: readonly LoopRun[]): string {
  let words = ''
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const cut = [...r.text.matchAll(/[,;:](?=\s|$)/g)].at(-1)
    if (cut) return r.text.slice(cut.index + 1) + words
    words = r.text + words
  }
  return words
}

/**
 * Whether the model's own words already say a number reference's value (FR-720.3): the words of
 * its clause give the same value, by value ("4 items [#r1.count]", "on 3 October 2026 [#r2…]"),
 * or the words right before it give a value of its kind, another one run into it ("on 19 May
 * [#r1…]"). Either way the reference is the value said twice and is left out; when it is a floor
 * ("13+") and the words give its number bare, the words' number becomes the floor.
 */
function saidAlready(runs: LoopRun[], run: LoopRun): boolean {
  const clause = clauseSoFar(runs)
  if (run.t === 'date') {
    const [y, m, d] = run.day.split('-').map(Number)
    const same = [...clause.matchAll(DAY)].some((x) =>
      x[4]
        ? x[4] === String(y) && Number(x[5]) === m && Number(x[6]) === d
        : Number(x[1]) === d &&
          MONTHS.indexOf(x[2]!) + 1 === m &&
          (x[3] === undefined || Number(x[3]) === y),
    )
    if (same) return true
  } else if (run.t === 'count') {
    const value = valueOf(run.value)
    const stated = [...clause.replace(DAY, (x) => ' '.repeat(x.length)).matchAll(NUMBER)]
      .filter((x) => valueOf(x[0]) === value)
      .at(-1)
    if (stated) {
      if (run.value.endsWith('+') && !stated[0].endsWith('+')) floorIn(runs, stated[0])
      return true
    }
  } else return false
  const last = runs.at(-1)
  const before = last?.t === 'text' ? last.text.trimEnd() : ''
  const day = [...before.matchAll(DAY)].at(-1)
  const ends = (x: RegExpExecArray | undefined) => !!x && x.index + x[0].length === before.length
  if (ends(day)) return run.t === 'date'
  // A year the words end with ("written in 2026") is no count run into the reference.
  const number = [...before.matchAll(NUMBER)].at(-1)
  return run.t === 'count' && ends(number) && !/^(?:19|20)\d{2}$/.test(number![0])
}

/** A number the words gave bare, the last time they gave it, written as the floor it is: "13+". */
function floorIn(runs: LoopRun[], number: string) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    const at = [...r.text.matchAll(NUMBER)].filter((x) => x[0] === number).at(-1)
    if (at) {
      r.text = `${r.text.slice(0, at.index + number.length)}+${r.text.slice(at.index + number.length)}`
      return
    }
  }
}

/** Runs of words, a run of plain words merged with the one before it. */
function pushRun(runs: LoopRun[], run: LoopRun) {
  const last = runs.at(-1)
  if (run.t === 'text' && last?.t === 'text') last.text += run.text
  else if (run.t !== 'text' || run.text) runs.push(run)
}

/**
 * The model's words checked and drawn (FR-720.2, FR-720.3): paragraphs, the short lists it wrote,
 * the lists of reads it asked for, and in each sentence its nouns, numbers and citations. A
 * sentence whose number no read holds is left out whole; a long enumeration after a colon becomes
 * a list. `cited` grows as items are cited, the first cited first, and the rows of a list of a read
 * are cited as they come.
 */
export function wordsOf(text: string, ctx: WordsContext, cited: string[] = []): Words {
  const checks: Check[] = []
  const cite = (id: string) => {
    if (!cited.includes(id)) cited.push(id)
    return cited.indexOf(id) + 1
  }
  const check = (kind: string, words: string) => {
    if (!checks.some((c) => c.kind === kind && c.words === words)) checks.push({ kind, words })
  }
  /** One sentence's runs, or null when a number in it is not one a read holds. */
  const sentence = (words: string): LoopRun[] | null => {
    const runs: LoopRun[] = []
    const citedBefore = cited.length
    let at = 0
    let failed = false
    for (const m of words.matchAll(TOKEN)) {
      pushRun(runs, { t: 'text', text: words.slice(at, m.index) })
      at = m.index + m[0].length
      const [whole, written, ref, path, list, inner, bare] = m
      // A typed id in a mark with no @ is a mention where the words need it: a person, or a noun
      // with words after it in its clause ("owned by [person:p_ada] and …"). At a clause's end,
      // a metric's or a value's (`… left out [metric:orders].`) marks a definition, no source,
      // and is left out, as is any that the sentence has named already.
      const typed = inner?.trim().match(/^([a-z]+:\S+)$/)?.[1]
      const kind = typed ? nounKindOf(typedId(typed)) : null
      const needed =
        kind === 'person' || /^\s*[\p{L}\p{N}]/u.test(words.slice(m.index + whole.length))
      const mention = written ?? (typed && kind && needed ? typed : undefined)
      if (mention !== undefined) {
        const id = typedId(mention)
        const name = ctx.nouns.get(id)?.name ?? plainName(id, ctx.nouns)
        if (written === undefined && nameIn(name).test(words.slice(0, m.index))) continue
        if (ctx.nouns.has(id)) pushRun(runs, { t: 'noun', id })
        else if (ITEM_ID.test(id) && ctx.known.has(id)) pushRun(runs, { t: 'cite', n: cite(id) })
        else {
          check('mention', mention)
          pushRun(runs, { t: 'text', text: name })
        }
      } else if (ref !== undefined && path !== undefined) {
        const read = ctx.reads.find((r) => r.ref === ref)
        const value = read ? valueAt(read.result, path.slice(1).split('.')) : undefined
        const run = numberRun(value)
        // A reference to an item's id that a read returned is that item's citation, not a number.
        if (typeof value === 'string' && ITEM_ID.test(value) && ctx.known.has(value))
          pushRun(runs, { t: 'cite', n: cite(value) })
        else if (!run) {
          check('number', whole)
          failed = true
        } else if (saidAlready(runs, run)) check('twice', whole)
        else pushRun(runs, run)
      } else if (list !== undefined) check('list', whole)
      else if (inner !== undefined) {
        // A mark cites items; any other id in one (a definition's) is no source, and is left out.
        for (const id of inner.split(/[,;]\s*|\s+/).map((x) => x.trim()))
          if (ITEM_ID.test(id) && ctx.known.has(id)) pushRun(runs, { t: 'cite', n: cite(id) })
      } else if (bare !== undefined) {
        if (ctx.known.has(bare)) pushRun(runs, { t: 'cite', n: cite(bare) })
        else pushRun(runs, { t: 'text', text: bare })
      }
    }
    pushRun(runs, { t: 'text', text: words.slice(at) })
    if (failed) {
      cited.length = citedBefore
      return null
    }
    // A citation sits right after what it supports: three or more at a sentence's end are a pile.
    let piled = 0
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i]!
      if (r.t === 'cite') piled++
      else if (r.t === 'text' && /^[\s.!?]*$/.test(r.text)) continue
      else break
    }
    if (piled >= 3) check('piled', runWords(runs, ctx.nouns))
    for (const r of runs)
      if (r.t === 'text')
        for (const d of r.text.match(/\d+(?:[.,]\d+)*/g) ?? [])
          if (!ctx.digits.has(d.replace(/,/g, ''))) check('digits', d)
    // A name the words give is said once: a mention after it is drawn on it (FR-720.3).
    return placed(runs, ctx.nouns)
  }
  /** A paragraph's sentences; a long enumeration after a colon as a lead and a list. */
  const paragraph = (words: string): LoopBlock[] => {
    const blocks: LoopBlock[] = []
    let runs: LoopRun[] = []
    const flush = () => {
      trimRuns(runs)
      if (runs.length) blocks.push({ t: 'p', runs })
      runs = []
    }
    for (const said of words.split(SENTENCE_END).filter((x) => x.trim())) {
      const parts = enumeration(said)
      if (parts) {
        const citedBefore = cited.length
        const checksBefore = checks.length
        const lead = sentence(parts.lead)
        const items = parts.items.map(sentence)
        if (lead && items.every(Boolean)) {
          if (runs.length) pushRun(runs, { t: 'text', text: ' ' })
          for (const r of lead) pushRun(runs, r)
          flush()
          blocks.push({ t: 'ul', items: items.map((i) => trimRuns(i!)) })
          continue
        }
        cited.length = citedBefore
        checks.length = checksBefore
      }
      const one = sentence(said)
      if (!one) continue
      if (said.split(',').length >= 6) check('enumeration', runWords(one, ctx.nouns))
      if (runs.length) pushRun(runs, { t: 'text', text: ' ' })
      for (const r of one) pushRun(runs, r)
    }
    flush()
    return blocks
  }
  const body: LoopBlock[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let prose: string[] = []
    let bullets: string[] = []
    const endProse = () => {
      if (prose.length) body.push(...paragraph(prose.join(' ')))
      prose = []
    }
    const endBullets = () => {
      if (bullets.length) {
        const items = bullets.flatMap((b) => {
          const runs = sentence(b)
          return runs ? [trimRuns(runs)] : []
        })
        if (items.length) body.push({ t: 'ul', items })
      }
      bullets = []
    }
    for (const line of para.split('\n')) {
      if (!line.trim()) continue
      const list = line.match(LIST_LINE)?.[1]
      if (list) {
        endProse()
        endBullets()
        const block = listOf(list, ctx, cite)
        if (block) body.push(block)
        else check('list', line.trim())
      } else if (BULLET.test(line)) {
        endProse()
        bullets.push(line.replace(BULLET, ''))
      } else if (bullets.length && /^\s{2,}/.test(line))
        bullets[bullets.length - 1] += ` ${line.trim()}`
      else {
        endBullets()
        prose.push(line.trim())
      }
    }
    endProse()
    endBullets()
  }
  return { body, cited, checks }
}

/** Runs with no space at their start or end. */
function trimRuns(runs: LoopRun[]): LoopRun[] {
  const first = runs[0]
  if (first?.t === 'text') first.text = first.text.replace(/^\s+/, '')
  const last = runs.at(-1)
  if (last?.t === 'text') last.text = last.text.replace(/\s+$/, '')
  return runs.filter((r) => r.t !== 'text' || r.text)
}

/** How deep in brackets, square or round, each character of some words sits; the brackets at their outer depth. */
function depths(words: string): number[] {
  const at: number[] = []
  let depth = 0
  for (let i = 0; i < words.length; i++) {
    const c = words[i]
    if (c === ']' || c === ')') depth = Math.max(0, depth - 1)
    at.push(depth)
    if (c === '[' || c === '(') depth++
  }
  return at
}

/** Where a pattern matches outside every bracket. */
const outside = (words: string, pattern: RegExp) => {
  const depth = depths(words)
  return [...words.matchAll(new RegExp(pattern.source, 'g'))].filter((m) => depth[m.index] === 0)
}

/**
 * Words that make a part of a sentence a clause, or a part of the thing named before it, not the
 * name of a thing: a verb ("18 are live", "it is owned by …"), "whose" or "which", or a
 * preposition it starts with ("France, in May 2026, and Spain, in October 2025").
 */
const CLAUSE =
  /\b(?:is|are|was|were|has|have|had|it's|whose|which|who)\b|^(?:in|on|at|for|from|with|by|of|to|since|until|after|before|during|as|into|about|over|under|across|between|than)\b/i

/**
 * A sentence that names four or more things after a colon ("They cover: a, b, c and d."), as its
 * lead and its items; null for any other sentence. Only a colon outside brackets ends a lead (a
 * "(source: …)" ends none), only commas and an "and" outside brackets split, and each item is a
 * thing named in a few words, never a clause ("it is owned by …", "whose owners are …"): any
 * other sentence stays whole.
 */
export function enumeration(said: string): { lead: string; items: string[] } | null {
  if (depths(`${said} `).at(-1)) return null
  const colon = outside(said, /: /)[0]?.index
  if (colon === undefined) return null
  const lead = said.slice(0, colon + 1)
  const rest = said
    .slice(colon + 2)
    .replace(/[.!]\s*((?:\[[^[\]\n]{1,200}\]\s*)*)$/, ' $1')
    .trim()
  const parts: string[] = []
  let from = 0
  for (const comma of outside(rest, /,/)) {
    parts.push(rest.slice(from, comma.index))
    from = comma.index + 1
  }
  parts.push(rest.slice(from))
  // The last part's last "and" joins the last two things named; no other "and" splits.
  const last = parts.pop() ?? ''
  const and = outside(last, /\s+and\s+/).at(-1)
  const tail = and ? [last.slice(0, and.index), last.slice(and.index + and[0].length)] : [last]
  const items = [...parts, ...tail].map((p) => p.replace(/^\s*and\s+/, '').trim()).filter(Boolean)
  // Things named, not clauses: four or more, each a few words.
  const named = items.every((i) => {
    const words = i.replace(/\[[^[\]]*\]/g, '').trim()
    return words.split(/\s+/).length <= 8 && !CLAUSE.test(words)
  })
  return items.length >= 4 && named ? { lead, items } : null
}

/** The items of a read the words asked for as a list (`[list:r1]`): each row cited as it comes. */
function listOf(
  ref: string,
  ctx: WordsContext,
  cite: (id: string) => number,
): Extract<LoopBlock, { t: 'list' }> | null {
  const read = ctx.reads.find((r) => r.ref === ref)
  if (!read || !isObj(read.result)) return null
  const r = read.result
  const ids = [
    ...arr(r.items).map((i) => str(i.id)),
    ...(isObj(r.item) ? [str(r.item.id)] : []),
    ...arr(r.pairs).flatMap((p) => [p.holder, p.other].filter(isObj).map((x) => str(x.id))),
  ].filter((id, i, all) => ctx.items.has(id) && all.indexOf(id) === i)
  if (!ids.length) return null
  for (const id of ids) cite(id)
  return { t: 'list', rows: ids, more: typeof r.more === 'number' ? r.more : 0 }
}

/** What an overview asks for: the read it shows, the groups of it, and a closing line. */
export type OverviewAsk = { from: string; groups?: readonly string[]; note?: string }

/** Why an overview cannot be drawn from what was asked, said to the model; null when it can. */
export function overviewProblem(ask: OverviewAsk, reads: readonly NumberedRead[]): string | null {
  const read = reads.find((r) => r.ref === ask.from)
  if (!read)
    return `No read is ${ask.from}: name one of ${reads.map((r) => r.ref).join(', ') || 'none'}.`
  const groups = groupsOf(read)
  if (!groups)
    return `${ask.from} has no groups. An overview shows the inbox read, or a records read with group_by.`
  const unknown = (ask.groups ?? []).filter((g) => !groups.some((x) => x.key === g || x.name === g))
  if (unknown.length)
    return `${ask.from} has no group ${unknown.join(', ')}. Its groups are ${groups.map((g) => g.key ?? g.name).join(', ')}.`
  return null
}

type Group = { key: string | null; name: string; count: number; rows: Obj[]; more: number }

/** A read's groups: the Inbox's, or the records' by one part; null when it has none. */
function groupsOf(read: NumberedRead): Group[] | null {
  const r = read.result
  if (!isObj(r)) return null
  if (read.tool === 'inbox')
    return arr(r.groups).map((g) => ({
      key: str(g.group),
      name: str(g.name),
      count: typeof g.count === 'number' ? g.count : 0,
      rows: arr(g.cards),
      more: typeof g.more === 'number' ? g.more : 0,
    }))
  if (read.tool === 'records' && isObj(r.groups))
    return arr(r.groups.rows).map((g) => ({
      key: typeof g.key === 'string' ? g.key : null,
      name: str(g.name),
      count: typeof g.count === 'number' ? g.count : 0,
      rows: arr(g.items),
      more: typeof g.more === 'number' ? g.more : 0,
    }))
  return null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * An overview (FR-720), by code from the read the model named: its groups in the read's own
 * order, each with its count and rows, the total the groups add up to, and the page's own count
 * when it differs, with why. Each row about an item the person may read cites it, in order.
 */
export function overviewOf(
  ask: OverviewAsk,
  ctx: WordsContext,
  cited: string[],
): { overview: LoopOverview; checks: Check[] } | null {
  const read = ctx.reads.find((r) => r.ref === ask.from)
  const all = read ? groupsOf(read) : null
  if (!read || !all || !isObj(read.result)) return null
  const r = read.result
  const chosen = ask.groups?.length
    ? all.filter((g) => ask.groups!.some((x) => x === g.key || x === g.name))
    : all
  const groups = chosen.filter((g) => g.count > 0)
  const total = groups.reduce((n, g) => n + g.count, 0)
  const cite = (id: string) => {
    if (!cited.includes(id)) cited.push(id)
  }
  const shown = groups.map((g) => ({
    key: g.key,
    name: g.name,
    count: g.count,
    more: g.more,
    rows: g.rows.map((row) => {
      const item =
        read.tool === 'inbox'
          ? typeof row.item === 'string' && ctx.known.has(row.item)
            ? row.item
            : null
          : ctx.known.has(str(row.id))
            ? str(row.id)
            : null
      if (item) cite(item)
      return {
        title: str(row.title),
        item,
        about: strs(row.about),
        domain: str(row.domainId) || null,
        status: str(row.why) || str(row.status),
        // The day that says why: a passed check date, else the last check.
        date:
          read.tool === 'inbox'
            ? str(row.date) || null
            : row.why === 'its check date passed'
              ? str(row.checkDate) || null
              : str(row.lastChecked) || null,
        card: read.tool === 'inbox' ? str(row.id) || null : null,
      }
    }),
  }))
  const count = (n: number): LoopRun => ({ t: 'count', value: n.toLocaleString('en-GB'), of: null })
  const whole = !ask.groups?.length
  let headline: LoopRun[]
  let page: LoopOverview['page'] = null
  if (read.tool === 'inbox') {
    headline = [
      count(total),
      {
        t: 'text',
        text: ` ${plural(total, 'card waits', 'cards wait')} on you in your Inbox, in `,
      },
      count(groups.length),
      { t: 'text', text: ` ${plural(groups.length, 'group', 'groups')}.` },
    ]
    const own = typeof r.count === 'number' ? r.count : total
    if (whole && own !== total) page = { count: own, why: str(r.differs) }
  } else {
    const outOf = isObj(r.outOf) ? r.outOf : {}
    const counted = typeof r.count === 'number' ? r.count : total
    const by = isObj(r.groups) ? str(r.groups.by) : ''
    headline = [
      count(counted),
      { t: 'text', text: ' of ' },
      {
        t: 'count',
        value: (typeof outOf.count === 'number' ? outOf.count : counted).toLocaleString('en-GB'),
        of: str(outOf.of) || null,
      },
      { t: 'text', text: `, by ${by}.` },
    ]
    if (whole && counted !== total)
      page = {
        count: counted,
        why: isObj(r.groups) ? str(r.groups.note) : '',
      }
  }
  const checks: Check[] = []
  let note: LoopRun[] | null = null
  if (ask.note?.trim()) {
    const words = wordsOf(ask.note, ctx, cited)
    checks.push(...words.checks)
    const runs = words.body.flatMap((b) => (b.t === 'p' ? b.runs : []))
    // A closing line is kept only when it carries a fact: something a read named, cited or counted.
    if (runs.some((x) => x.t !== 'text')) note = runs
    else checks.push({ kind: 'note', words: ask.note.trim() })
  }
  return {
    overview: {
      from: read.tool === 'inbox' ? 'inbox' : 'records',
      by: read.tool === 'inbox' ? 'group' : isObj(r.groups) ? str(r.groups.by) : '',
      total,
      headline,
      page,
      order: read.tool === 'inbox' ? str(r.order) : isObj(r.groups) ? str(r.groups.order) : '',
      groups: shown,
      note,
    },
    checks,
  }
}

/** An overview in plain words: what the chat sends back, copies and shows in History. */
export function overviewWords(
  o: LoopOverview,
  nouns: ReadonlyMap<string, Noun>,
  cited: readonly string[],
) {
  const lines = [runWords(o.headline, nouns)]
  if (o.page)
    lines.push(`${o.page.count.toLocaleString('en-GB')} as the page counts them: ${o.page.why}`)
  for (const g of o.groups) {
    lines.push(`${g.name} (${g.count.toLocaleString('en-GB')}):`)
    for (const row of g.rows)
      lines.push(`- ${row.title}${row.item ? ` [${cited.indexOf(row.item) + 1}]` : ''}`)
    if (g.more) lines.push(`- and ${g.more.toLocaleString('en-GB')} more`)
  }
  if (o.note) lines.push(runWords(o.note, nouns))
  return lines.join('\n')
}

/**
 * The blocks as the model writes them: each noun as its typed mention, each citation as the id it
 * cites, each number and day in words. What the chat sends back as Ask's earlier reply, so the
 * model reads its own words as it wrote them.
 */
export function bodyMarkup(
  body: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>,
  cited: readonly string[],
): string {
  const mark = (n: number) => `[${cited[n - 1] ?? n}]`
  const marked = (runs: readonly LoopRun[]) =>
    runWords(
      runs.map((r) =>
        r.t === 'noun'
          ? { t: 'text' as const, text: `[@${r.id}]` }
          : r.t === 'cite'
            ? { t: 'text' as const, text: mark(r.n) }
            : r,
      ),
      nouns,
    )
  return body
    .map((b) =>
      b.t === 'p'
        ? marked(b.runs)
        : b.t === 'ul'
          ? b.items.map((i) => `- ${marked(i)}`).join('\n')
          : b.rows.map((id) => `- ${items.get(id)?.title ?? id} [${id}]`).join('\n'),
    )
    .join('\n\n')
}

/** Where the last sentence in some words begins, just after the space that ends the one before; -1 when none ends in them. */
const lastSentenceStart = (text: string) => {
  let at = -1
  for (const m of text.matchAll(/[.!?]["'”’)]*\s+/g)) at = m.index + m[0].length
  return at
}

/**
 * Which runs only trail their clause: marks after the words, with nothing but more marks, space
 * and the clause's end after them ("… the Poland market [@metric:orders] [@value:market/poland].").
 */
function trailingRuns(runs: readonly LoopRun[]): boolean[] {
  const trailing = runs.map(() => false)
  let tail = true
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t === 'text') tail = /^[\s"'”’)]*(?:[.,;:!?]|$)/.test(r.text)
    else if (r.t === 'noun' || r.t === 'cite') trailing[i] = tail
    else tail = false
  }
  return trailing
}

/**
 * A sentence's runs with each noun's chip where the sentence names it: a mention that follows its
 * own name, or that only trails its clause after words that give its name, is drawn on those words
 * instead ("the [Poland] market", not "the Poland market [Poland]"), and a trailing mention of a
 * noun the sentence has drawn already is left out. A mention anywhere else stays where it is.
 */
function placed(runs: readonly LoopRun[], nouns: ReadonlyMap<string, Noun>): LoopRun[] {
  const out: LoopRun[] = []
  const trailing = trailingRuns(runs)
  // Where the sentence being read starts: a run, and the place in it when it is words.
  let from = { run: 0, at: 0 }
  const inSentence = (i: number, at: number) => i > from.run || (i === from.run && at >= from.at)
  /** Where the words so far give a name: where they end with it, or its first place this sentence. */
  const find = (name: RegExp, ending: boolean) => {
    if (ending) {
      const i = out.length - 1
      const x = out[i]
      const m = x?.t === 'text' ? new RegExp(`${name.source}\\s*$`, 'iu').exec(x.text) : null
      return m && inSentence(i, m.index) ? { i, at: m.index, length: m[0].trimEnd().length } : null
    }
    for (let i = from.run; i < out.length; i++) {
      const x = out[i]!
      if (x.t !== 'text') continue
      const start = i === from.run ? from.at : 0
      const m = name.exec(x.text.slice(start))
      if (m) return { i, at: start + m.index, length: m[0].length }
    }
    return null
  }
  runs.forEach((r, n) => {
    if (r.t === 'noun') {
      if (trailing[n] && out.slice(from.run).some((x) => x.t === 'noun' && x.id === r.id)) return
      const name = nouns.get(r.id)?.name
      const found = name
        ? (find(nameIn(name), true) ?? (trailing[n] ? find(nameIn(name), false) : null))
        : null
      if (!found) {
        out.push(r)
        return
      }
      const x = out[found.i] as Extract<LoopRun, { t: 'text' }>
      const after = x.text.slice(found.at + found.length)
      out.splice(
        found.i,
        1,
        ...(found.at ? [{ t: 'text' as const, text: x.text.slice(0, found.at) }] : []),
        r,
        ...(after ? [{ t: 'text' as const, text: after }] : []),
      )
    } else if (r.t === 'text') {
      const last = out.at(-1)
      const start = lastSentenceStart(r.text)
      if (last?.t === 'text') {
        if (start >= 0) from = { run: out.length - 1, at: last.text.length + start }
        out[out.length - 1] = { ...last, text: last.text + r.text }
      } else {
        if (start >= 0) from = { run: out.length, at: start }
        out.push({ ...r })
      }
    } else out.push(r)
  })
  return out.flatMap((x): LoopRun[] => {
    if (x.t !== 'text') return [x]
    // A mention drawn on its name elsewhere leaves the commas it sat between: one is kept.
    const text = x.text
      .replace(/[,;](?=[ \t]*[,;.!?])/g, '')
      .replace(/[ \t]+([.,;:!?)])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
    return text ? [{ ...x, text }] : []
  })
}

/** A paragraph without its last sentence; null when it is that one sentence. */
export function withoutLastSentence(runs: readonly LoopRun[]): LoopRun[] | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (r.t !== 'text') continue
    // The colon that leads into the list ends the sentence: look before it.
    const at = lastSentenceStart(i === runs.length - 1 ? r.text.replace(/:\s*$/, '') : r.text)
    if (at < 0) continue
    const kept = trimRuns([
      ...runs.slice(0, i).map((x) => ({ ...x })),
      { ...r, text: r.text.slice(0, at) },
    ])
    return kept.length ? kept : null
  }
  return null
}

/**
 * The words as the page shows them beside code's evidence (FR-720), from the blocks as written:
 * each noun's chip where its sentence names it first; under Not found, no citation, since nothing
 * cited is a source, and no list of the items the closest written show below it, nor the line
 * that leads into one. What the chat sends back and what is graded keep the words as written.
 */
export function shownBody(
  written: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  notFound: { cited: readonly string[]; closest: ReadonlySet<string> } | null,
): LoopBlock[] {
  const out: LoopBlock[] = []
  const closest = (runs: readonly LoopRun[]) =>
    runs.some((r) => r.t === 'cite' && notFound?.closest.has(notFound.cited[r.n - 1] ?? ''))
  for (const b of written) {
    if (
      notFound &&
      (b.t === 'list' || (b.t === 'ul' && b.items.filter(closest).length * 2 >= b.items.length))
    ) {
      const lead = out.at(-1)
      const last = lead?.t === 'p' ? lead.runs.at(-1) : undefined
      if (lead?.t === 'p' && last?.t === 'text' && /:\s*$/.test(last.text)) {
        const rest = withoutLastSentence(lead.runs)
        if (rest) lead.runs = rest
        else out.pop()
      }
      continue
    }
    const shown = (runs: readonly LoopRun[]) =>
      placed(notFound ? runs.filter((r) => r.t !== 'cite') : runs, nouns)
    if (b.t === 'p') out.push({ ...b, runs: shown(b.runs) })
    else if (b.t === 'ul') out.push({ ...b, items: b.items.map(shown) })
    else out.push(b)
  }
  return out
}

/** The blocks in plain words: paragraphs, then each list's lines with "- ". */
export function bodyWords(
  body: readonly LoopBlock[],
  nouns: ReadonlyMap<string, Noun>,
  items: ReadonlyMap<string, Omit<LoopItem, 'n'>>,
  cited: readonly string[],
): string {
  return body
    .map((b) =>
      b.t === 'p'
        ? runWords(b.runs, nouns)
        : b.t === 'ul'
          ? b.items.map((i) => `- ${runWords(i, nouns)}`).join('\n')
          : b.rows
              .map((id) => `- ${items.get(id)?.title ?? id} [${cited.indexOf(id) + 1}]`)
              .join('\n'),
    )
    .join('\n\n')
}
