import type { ItemKind } from '@domain/item'
import { productName } from '@/lib/brand'

/*
  The words that help a contributor answer "Where this comes from" (the stored `evidence`) and
  "What not to conclude" (the stored `notToConclude`) in Add a fact and Suggest a change. Where
  it comes from is needed (FR-116): a link, a sentence copied from the source and the day it was
  read. What not to conclude is optional (FR-104): left empty, the default is stored. The examples
  follow the item's kind, so a person writing an issue reads issue examples. Every sentence is
  short and plain, for people who are not data specialists and may read English as a second
  language.
*/

export const sourceWords = {
  title: 'Where this comes from',
  help: 'Add a link and copy one sentence from it, so the owner can check it.',
  link: 'Link to the source',
  quote: 'A sentence copied from the source',
  quoteHelp: 'Copy it word for word. One or two sentences, not the whole page.',
  date: 'Date you read it',
}

/**
 * Capture from anywhere (lib/capture.ts): how to install the bookmarklet, behind a quiet link in
 * the source section's help line.
 */
export const captureWords = {
  trigger: 'From any page',
  title: 'Add a source from any page',
  install:
    'Drag the button below to your bookmarks bar. On any page, select a sentence and click the ' +
    'bookmark: Add a fact opens with the page link and the sentence filled in.',
  check: 'Check both before you send it. We keep only what you see in the form.',
  button: `Add to ${productName}`,
  copy: 'No bookmarks bar? Make a bookmark and paste this as its address:',
  bookmarklet: 'the bookmarklet',
  link: 'Other tools can open the form the same way:',
  format: '/library/new?evidence_url=<page link>&quote=<sentence>',
  linkLabel: 'the link format',
}

/** "What not to conclude" (FR-104): optional, and said in plain sight how AI apps use it. */
export const caveatWords = {
  title: 'What not to conclude',
  optional: 'Optional',
  help: 'Say what someone might wrongly conclude from this.',
  /** What happens to the line, always visible: never behind a popover. */
  how: 'AI apps get this line with the fact and are told not to draw that conclusion.',
  starters: 'Start a sentence',
  example: 'Example',
  useExample: 'Use this',
  /** The live card under the field: the fact as an AI app gets it. */
  card: 'What AI apps get',
  untitled: 'Your fact',
  /** The card, with the box empty and the claim level saying the cause is not proven. */
  empty: "Nothing added. AI apps already know this fact doesn't prove a cause.",
  /** The card, with the box empty on a fact whose source states the effect. */
  emptyStated: 'Nothing added. AI apps get the fact without this line.',
  showRaw: 'Show exactly what AI apps get',
  hideRaw: 'Hide exactly what AI apps get',
  rawEmpty: 'Nothing for this field. AI apps get the fact without it.',
  /** The fact page, under the line. */
  readers: 'AI apps get this line with the fact.',
}

/**
 * The sentence starters under the box: the three shapes a useful line takes (a wrong
 * conclusion, a wrong use, who to ask first). A tap puts the opening words in the box.
 */
export const caveatStarters = [
  { label: "It doesn't tell you …", text: "It doesn't tell you " },
  { label: "Don't use for …", text: "Don't use this for " },
  { label: 'Check with …', text: 'Check with ' },
] as const

/** Why the form asks, for the "Why we ask" popover of a section. */
export const whyWeAsk = {
  source:
    'The owner opens the link to check the fact, and AI apps name it as the source when they ' +
    'use this fact. We keep the link and the sentence you copied, never the whole document.',
}

export type KindHelp = {
  /** Two kinds of source that fit the kind: the help under the link. */
  sources: string
  /** Two sentences someone might copy from such a source. */
  quotes: readonly [string, string]
  /** A line of what not to conclude from an item of this kind, shown with "Use this". */
  caveat: string
}

export const kindHelp: Record<ItemKind, KindHelp> = {
  event: {
    sources: 'For example a press release or a regulator notice.',
    quotes: [
      'Online sales to Norway stop from 4 August 2026.',
      'The new VAT rate of 12% applies from 1 June.',
    ],
    caveat: "Lower orders in Norway after 4 August don't mean fewer customers.",
  },
  note: {
    sources: 'For example a data dictionary or a team decision on the wiki.',
    quotes: [
      'Test accounts are excluded from all repeat purchase figures.',
      'Amounts are shown in local currency before conversion.',
    ],
    caveat: "It doesn't count customers who closed their account within a day.",
  },
  guide: {
    sources: 'For example a runbook or an analysis the team trusts.',
    quotes: [
      'Check the campaign calendar before comparing two weeks.',
      'Compare with the same weekday last year.',
    ],
    caveat: "It doesn't tell you why the metric moved.",
  },
  example: {
    sources: 'For example the report or the dashboard that holds the answer.',
    quotes: [
      'Orders fell 8% in week 32, confirmed by Finance.',
      'The figure was checked against the monthly report.',
    ],
    caveat: "It doesn't answer the same question for other dates.",
  },
  issue: {
    sources: 'For example a status page or a ticket from the provider.',
    quotes: [
      'Order data from the payment provider is delayed by two days.',
      'Tracking in the Spain app stopped on 3 October.',
    ],
    caveat: "Low orders on these days don't mean customers ordered less.",
  },
}

/** Two examples as one placeholder: `For example: "First" or "Second"`. */
export function examplesPlaceholder([first, second]: readonly [string, string]): string {
  return `For example: "${first}" or "${second}"`
}
