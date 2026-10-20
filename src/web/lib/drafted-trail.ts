import { listWords } from '@domain/proposal-attributes'
import { fieldWords } from './provenance'
import { markedFields, type FieldMark, type Provenance } from '@domain/provenance'
import type { Gate } from '@/api'
import { gateHeadline, readGate } from '@/lib/gate'
import { formatDay } from '@/lib/library'

/*
  What happened to a draft an AI app or the assistant wrote for a person, before an owner reads
  it (contract 9.8, the step trail on the review page): the pages it read, the fields it wrote,
  what the person confirmed when it asked, what Heed filled in, kept at its default or left for
  people, what it flagged, who submitted it and how the fixed checks came out. Every step comes
  from the stored provenance, the proposal and the checks, never from a model's words, and only
  steps that happened are listed.
*/

export type DraftedStep = {
  id: string
  icon: 'web' | 'wrote' | 'confirmed' | 'derived' | 'default' | 'left' | 'flag' | 'submit' | 'check'
  words: string
  object: string | null
  after: string | null
  /** What it found, after a middle dot: a day, how the checks came out. */
  counts: string | null
  /** The fields it names, muted after a middle dot. */
  note: string | null
}

const fields = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'field' : 'fields'}`

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** The fields with one mark, by name, in the form's order. */
const marked = (provenance: Provenance, mark: FieldMark) =>
  markedFields.filter((field) => provenance.fields[field] === mark).map((f) => fieldWords[f])

export function draftedSteps(
  provenance: Provenance,
  {
    proposer,
    submittedAt,
    gate,
  }: {
    /** The proposer's first name, or "You" when it is the person reading. */
    proposer: string
    submittedAt: string | null
    gate: Pick<Gate, 'required' | 'levels'> | null
  },
): DraftedStep[] {
  const writer = provenance.by === 'agent' ? 'An AI app' : 'The assistant'
  const it = provenance.by === 'agent' ? 'the AI app' : 'the assistant'
  const steps: DraftedStep[] = []
  const step = (s: Pick<DraftedStep, 'id' | 'icon' | 'words'> & Partial<DraftedStep>) =>
    steps.push({ object: null, after: null, counts: null, note: null, ...s })

  for (const [index, source] of (provenance.external ?? []).entries())
    step({
      id: `read-${index}`,
      icon: 'web',
      words: `${writer} read`,
      object: siteOf(source.url),
      counts: formatDay(source.readOn),
    })
  const wrote = marked(provenance, 'prefilled')
  if (wrote.length)
    step({
      id: 'wrote',
      icon: 'wrote',
      words: steps.length ? 'It wrote' : `${writer} wrote`,
      object: fields(wrote.length),
      note: listWords(wrote),
    })
  const confirmed = marked(provenance, 'confirmed')
  if (confirmed.length)
    step({
      id: 'confirmed',
      icon: 'confirmed',
      words: `${proposer} confirmed`,
      object: fields(confirmed.length),
      after: `when ${it} asked`,
      note: listWords(confirmed),
    })
  const derived = marked(provenance, 'derived')
  if (derived.length)
    step({
      id: 'derived',
      icon: 'derived',
      words: 'We filled in',
      object: fields(derived.length),
      note: listWords(derived),
    })
  const defaults = marked(provenance, 'default')
  if (defaults.length)
    step({
      id: 'default',
      icon: 'default',
      words: 'We kept the default for',
      object: fields(defaults.length),
      note: listWords(defaults),
    })
  const left = marked(provenance, 'not_inferred')
  if (left.length)
    step({
      id: 'left',
      icon: 'left',
      words: 'We left',
      object: fields(left.length),
      after: 'for people',
      note: listWords(left),
    })
  if (provenance.flags.length) {
    const flagged = [...new Set(provenance.flags.map((flag) => fieldWords[flag.field]))]
    step({
      id: 'flags',
      icon: 'flag',
      words: 'We flagged',
      object: fields(flagged.length),
      after: 'to check',
      note: listWords(flagged),
    })
  }
  if (submittedAt)
    step({
      id: 'submitted',
      icon: 'submit',
      words: `${proposer} sent it`,
      counts: formatDay(submittedAt.slice(0, 10)),
    })
  const readings = gate ? readGate(gate) : []
  if (readings.length)
    step({
      id: 'checks',
      icon: 'check',
      words: 'We ran the checks',
      counts: gateHeadline(readings),
    })
  return steps
}

/** The folded trail's words: who drafted it and in how many steps. */
export function draftedSummary(provenance: Provenance, steps: readonly DraftedStep[]): string {
  const n = steps.length
  return `${provenance.by === 'agent' ? 'Drafted with an AI app' : 'Drafted with the assistant'} · ${n.toLocaleString('en')} ${n === 1 ? 'step' : 'steps'}`
}
