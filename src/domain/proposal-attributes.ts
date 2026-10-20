/*
  The attributes of a proposal, in one place (FR-101, FR-121). Two write paths fill them: the
  Add context and Suggest a change form a person types into, and the MCP tool `draft_context` an
  AI agent calls for the person (with the assistant's `create_draft` behind the same service
  function). This file is what keeps the two from drifting apart:

  - the limits and the required fields that the item version schema, the draft schema, the form
    and the tool's input all read, instead of each holding its own copy;
  - which form fields edit each attribute, or why the form has none;
  - how the agent tool treats each attribute (derived, defaulted, prefilled for the person to
    confirm, or never inferred), the marks its drafts may carry, the questions that may ask the
    person for it, and the tool input that may suggest it;
  - the provenance table: the mark vocabulary and the attributes that carry a mark.

  The few rules the app's first load needs (the limits, the marks and the fields that carry one)
  live in ./proposal-rules.ts, which this file re-exports: the rest of the table stays out of the
  first load. tests/server/proposal-attributes.test.ts and tests/unit/proposal-attributes.test.ts
  enumerate every attribute of the item version schema and every field of the form and the tool,
  and fail until a new or changed attribute is classified here. CONTRIBUTING.md, "Proposal
  attributes", says what to do when they fail.
*/

import { markedFields, type FieldMark, type MarkedField } from './proposal-rules.ts'

export {
  draftStorageLimits,
  fieldMarks,
  limits,
  markedFields,
  toolInputLimits,
  type FieldMark,
  type MarkedField,
} from './proposal-rules.ts'

/**
 * How the agent tool treats an attribute. `derived`: Heed works it out exactly (from the
 * vocabulary, the area, the signed-in person). `defaulted`: the documented default, which only
 * people change. `prefilled`: the agent may suggest it, and the person confirms it before it
 * counts. `never_inferred`: never filled from what an agent passes; people decide it.
 */
export const agentTreatments = ['derived', 'defaulted', 'prefilled', 'never_inferred'] as const
export type AgentTreatment = (typeof agentTreatments)[number]

/** The questions the agent tool may ask the person, in its result or in their AI app. */
export const questionIds = ['area', 'kind', 'scope', 'start', 'end', 'evidence'] as const
export type QuestionId = (typeof questionIds)[number]

/** The fields of the form (`contextFormSchema`, src/web/lib/context-form.ts). */
export const formFields = [
  'kind',
  'title',
  'summaryMarkup',
  'bodyMarkup',
  'scope',
  'validity',
  'ended',
  'evidence',
  'areaId',
  'notToConclude',
  'reason',
] as const
export type FormField = (typeof formFields)[number]
/**
 * Form fields that edit no attribute of the item, with why. They are the proposal's own, so
 * draft_context never sets them.
 */
export const proposalOnlyFields: Partial<Record<FormField, string>> = {
  reason:
    "What is wrong with the current version, on Suggest a change: the proposal's reason for its reviewers, not part of the item.",
}

/** The inputs of `draft_context` (`draftInput`, src/server/mcp/schemas.ts). */
export const toolInputs = [
  'text',
  'title',
  'summary',
  'kind',
  'scope',
  'window',
  'evidence',
  'not_to_conclude',
  'area',
  'item_id',
  'new_item',
] as const
export type ToolInput = (typeof toolInputs)[number]

/** The tool inputs that steer the call rather than suggest an attribute, and what they do. */
export const toolControls = {
  item_id: 'Suggest a change to this accepted item instead of a new one (FR-111).',
  new_item: 'The person said it is new after possible duplicates were listed.',
} as const satisfies Partial<Record<ToolInput, string>>

type AttributeSpec = {
  /** The attribute in a person's words, for lists of fields to check. */
  words: string
  /** The version cannot be submitted without it. */
  required: boolean
  /** The form fields that edit it, or why the form has none. */
  form: readonly FormField[] | { none: string }
  /** For a required attribute the form can leave blank without a finding: what fills it. */
  blank?: string
  agent: {
    treatment: AgentTreatment
    /** Why, in one sentence: what the tool does with it. */
    why: string
    /** The marks an agent's draft may carry for it. Empty when it carries none. */
    marks: readonly FieldMark[]
    /** The questions that may ask the person for it, in the tool's result or their AI app. */
    asks?: readonly QuestionId[]
    /** The tool inputs that may suggest it. */
    inputs?: readonly ToolInput[]
    /** For a required attribute the agent may leave out: what fills it instead of a question. */
    fallback?: string
  }
}

/**
 * Every attribute of a proposal's version (`itemVersionSchema`, src/domain/item-version.ts), in
 * the form's reading order. The order is the order of the marks a person reads.
 */
export const proposalAttributes = {
  kind: {
    words: 'kind',
    required: true,
    form: ['kind'],
    blank: 'The form always has a kind chosen.',
    agent: {
      treatment: 'prefilled',
      why: 'The agent may suggest it, or a rule reads it from the words; the person confirms it.',
      marks: ['prefilled', 'confirmed'],
      asks: ['kind'],
      inputs: ['kind'],
    },
  },
  areaId: {
    words: 'domain',
    required: true,
    form: ['areaId'],
    agent: {
      treatment: 'derived',
      why: 'The one domain of every metric in its scope; otherwise the person chooses it.',
      marks: ['derived', 'prefilled', 'confirmed'],
      asks: ['area'],
      inputs: ['area'],
    },
  },
  ownerId: {
    words: 'owner',
    required: true,
    form: { none: "The domain's owner, set by the service (FR-105)." },
    agent: {
      treatment: 'derived',
      why: "The domain's owner; never a name from the words.",
      marks: ['derived'],
    },
  },
  title: {
    words: 'title',
    required: true,
    form: ['title'],
    blank: 'The first sentence of the summary.',
    agent: {
      treatment: 'prefilled',
      why: 'Written by the agent, or the first words of the summary.',
      marks: ['prefilled'],
      inputs: ['title', 'text'],
      fallback: 'The first words of the summary.',
    },
  },
  summary: {
    words: 'summary',
    required: true,
    form: ['summaryMarkup'],
    agent: {
      treatment: 'prefilled',
      why: "Written by the agent from the person's words.",
      marks: ['prefilled'],
      inputs: ['summary', 'text'],
    },
  },
  summaryMarkup: {
    words: 'summary',
    required: false,
    form: ['summaryMarkup'],
    agent: {
      treatment: 'never_inferred',
      why: "Mention markup: an agent's words stay plain text, and an agent never adds a mention.",
      marks: [],
    },
  },
  body: {
    words: 'body',
    required: false,
    form: ['bodyMarkup'],
    agent: {
      treatment: 'prefilled',
      why: 'The rest of the words, past the summary.',
      marks: ['prefilled'],
      inputs: ['text'],
    },
  },
  bodyMarkup: {
    words: 'body',
    required: false,
    form: ['bodyMarkup'],
    agent: {
      treatment: 'never_inferred',
      why: "Mention markup: an agent's words stay plain text, and an agent never adds a mention.",
      marks: [],
    },
  },
  mentions: {
    words: 'mentions',
    required: true,
    form: { none: 'Derived from the mention markup of the summary and the body.' },
    agent: {
      treatment: 'never_inferred',
      why: 'No automatic mentions (R23).',
      marks: [],
    },
  },
  scope: {
    words: 'where it applies',
    required: true,
    form: ['scope'],
    agent: {
      treatment: 'prefilled',
      why: 'Names matched to the vocabulary, never a key from memory; the person confirms it.',
      marks: ['prefilled', 'confirmed'],
      asks: ['scope'],
      inputs: ['scope', 'text'],
    },
  },
  validity: {
    words: 'when it applies',
    required: true,
    form: ['validity', 'ended'],
    agent: {
      treatment: 'prefilled',
      why: 'The dates the agent passes or the words name; otherwise the person says.',
      marks: ['prefilled', 'confirmed'],
      asks: ['start', 'end'],
      inputs: ['window', 'text'],
    },
  },
  reviewDate: {
    words: 'review date',
    required: true,
    form: { none: 'The default for its kind, set by the service (FR-127, FR-135).' },
    agent: {
      treatment: 'derived',
      why: 'The default review date for its kind.',
      marks: ['derived'],
    },
  },
  evidence: {
    words: 'where it comes from',
    required: true,
    form: ['evidence'],
    agent: {
      treatment: 'prefilled',
      why: 'Only links and sentences the agent read or the person gave; never invented.',
      marks: ['prefilled', 'confirmed'],
      asks: ['evidence'],
      inputs: ['evidence'],
    },
  },
  references: {
    words: 'references',
    required: true,
    form: { none: 'The definitions of the terms in its scope, set by the service.' },
    agent: {
      treatment: 'derived',
      why: 'The definitions of the metrics and dimensions in its scope.',
      marks: ['derived'],
    },
  },
  changeMarks: {
    words: 'definition marks',
    required: true,
    form: { none: 'The reviewed change mark of each reference, set by the service.' },
    agent: {
      treatment: 'derived',
      why: 'The change mark of each reference.',
      marks: ['derived'],
    },
  },
  claimLevel: {
    words: 'cause',
    required: true,
    form: { none: 'A fact by default; only an owner states an effect (FR-324).' },
    agent: {
      treatment: 'defaulted',
      why: 'A fact with no stated effect; only an owner states an effect.',
      marks: ['default'],
    },
  },
  claimAuthority: {
    words: 'who stated the effect',
    required: false,
    form: { none: 'Only with an effect claim, which an owner states (FR-324).' },
    agent: {
      treatment: 'never_inferred',
      why: 'Only an owner states an effect.',
      marks: [],
    },
  },
  claimQuote: {
    words: 'the stated effect',
    required: false,
    form: { none: 'Only with an effect claim, which an owner states (FR-324).' },
    agent: {
      treatment: 'never_inferred',
      why: 'Only an owner states an effect.',
      marks: [],
    },
  },
  riskLevel: {
    words: 'risk level',
    required: true,
    form: { none: 'The default for its kind; only an owner raises it (FR-106).' },
    agent: {
      treatment: 'defaulted',
      why: 'The default for its kind; only words that may mean high risk are flagged.',
      marks: ['default'],
    },
  },
  audience: {
    words: 'audience',
    required: true,
    form: { none: 'Everyone: the only audience the schema allows today.' },
    agent: {
      treatment: 'defaulted',
      why: 'Everyone; audience groups are never inferred.',
      marks: ['default'],
    },
  },
  proposerId: {
    words: 'proposer',
    required: true,
    form: { none: 'The signed-in person, set by the service.' },
    agent: {
      treatment: 'derived',
      why: 'The person the sign-in names, never a name from the words.',
      marks: [],
    },
  },
  createdVia: {
    words: 'channel',
    required: true,
    form: { none: 'The channel the draft came through, set by the service.' },
    agent: {
      treatment: 'derived',
      why: 'Always the agent tool.',
      marks: [],
    },
  },
  notToConclude: {
    words: 'what not to conclude',
    required: true,
    form: ['notToConclude'],
    blank: 'Optional in the form: an empty box stores the default, cause not proven.',
    agent: {
      treatment: 'prefilled',
      why: 'Written by the agent when the person said; otherwise the default, cause not proven.',
      marks: ['prefilled', 'default'],
      inputs: ['not_to_conclude'],
      fallback: 'The default, cause not proven.',
    },
  },
  replaces: {
    words: 'replaces',
    required: true,
    form: { none: 'Decided by people at review; overlapping items are only listed (FR-219).' },
    agent: {
      treatment: 'never_inferred',
      why: 'Left for people; only the items that overlap are listed.',
      marks: ['not_inferred'],
    },
  },
  conflicts: {
    words: 'conflicts',
    required: true,
    form: { none: 'Decided by people at review; overlapping items are only listed (FR-220).' },
    agent: {
      treatment: 'never_inferred',
      why: 'Left for people; only the items that overlap are listed.',
      marks: ['not_inferred'],
    },
  },
} as const satisfies Record<string, AttributeSpec>

export type ProposalAttribute = keyof typeof proposalAttributes
export const attributeNames = Object.keys(proposalAttributes) as ProposalAttribute[]

/** Whether an attribute carries a provenance mark of its own (markup is marked with its text). */
export const isMarked = (name: ProposalAttribute): name is MarkedField =>
  (markedFields as readonly string[]).includes(name)

/** The words of a marked attribute, for lists of fields to check. */
export const fieldWords = Object.fromEntries(
  markedFields.map((field) => [field, proposalAttributes[field].words]),
) as Record<MarkedField, string>

/** The attributes the agent tool treats one way, in reading order. */
export function attributesTreated(treatment: AgentTreatment): ProposalAttribute[] {
  return attributeNames.filter((name) => proposalAttributes[name].agent.treatment === treatment)
}

/** "kind, title and summary". */
export function listWords(words: readonly string[]): string {
  const unique = [...new Set(words)]
  return unique.length > 1
    ? `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
    : (unique[0] ?? '')
}

/**
 * What the agent tool says about the attributes, for its MCP description: generated from the
 * table above, so the description cannot fall behind it.
 */
export function agentTreatmentSentence(): string {
  const words = (treatment: AgentTreatment, skip: readonly ProposalAttribute[] = []) =>
    listWords(
      attributesTreated(treatment)
        .filter((name) => !skip.includes(name))
        .map((name) => proposalAttributes[name].words),
    )
  return (
    `You may suggest the ${words('prefilled')}. ` +
    `The ${words('derived', ['proposerId', 'createdVia'])} are worked out for you, ` +
    `the ${words('defaulted')} take their defaults, ` +
    `and the ${words('never_inferred', ['summaryMarkup', 'bodyMarkup'])} are never filled from what you pass.`
  )
}
