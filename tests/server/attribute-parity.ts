import {
  fieldMarks,
  isMarked,
  proposalAttributes,
  toolControls,
  toolInputs,
  type AgentTreatment,
  type ProposalAttribute,
} from '../../src/domain/proposal-attributes.ts'

/*
  The checks of the alignment guard (CONTRIBUTING.md, "Proposal attributes"): each returns what
  is out of line, as sentences that say what to do, so a failing test reads as instructions. They
  take what they compare as arguments, so the tests also run them on a schema with one attribute
  too many and see them fail.
*/

type Registry = Record<string, (typeof proposalAttributes)[ProposalAttribute]>
const how =
  'Add it to proposalAttributes in src/domain/proposal-attributes.ts: its words, whether it is required, the form fields that edit it (or why there are none), and how draft_context treats it (derived, defaulted, prefilled or never_inferred), with the marks its drafts may carry and, if the tool asks for it, its question. See CONTRIBUTING.md, "Proposal attributes".'

/** Every attribute of the item version schema is classified, and nothing else is. */
export function unclassified(
  schemaAttributes: readonly string[],
  registry: Registry = proposalAttributes,
): string[] {
  return [
    ...schemaAttributes
      .filter((name) => !Object.hasOwn(registry, name))
      .map(
        (name) =>
          `"${name}" is an attribute of the item version schema, but no one decided how the form and the agent tool treat it. ${how}`,
      ),
    ...Object.keys(registry)
      .filter((name) => !schemaAttributes.includes(name))
      .map(
        (name) =>
          `"${name}" is classified in src/domain/proposal-attributes.ts but is no longer an attribute of the item version schema. Remove it there, with its form fields, tool inputs and questions.`,
      ),
  ]
}

/** The schema's required attributes are the registry's, and the other way round. */
export function requiredMismatch(
  optional: (name: string) => boolean,
  registry: Registry = proposalAttributes,
): string[] {
  return Object.entries(registry)
    .filter(([name, spec]) => spec.required === optional(name))
    .map(
      ([name, spec]) =>
        `"${name}" is ${spec.required ? 'required' : 'optional'} in src/domain/proposal-attributes.ts but ${spec.required ? 'optional' : 'required'} in the item version schema. Change one so they agree, and check what the form and draft_context do when it is missing.`,
    )
}

/** The tool's inputs are exactly the registry's, each suggesting attributes it may suggest. */
export function toolInputMismatch(
  inputs: readonly string[],
  registry: Registry = proposalAttributes,
): string[] {
  const problems: string[] = []
  const suggests = new Map<string, string[]>()
  for (const [name, spec] of Object.entries(registry))
    for (const input of (spec.agent as { inputs?: readonly string[] }).inputs ?? [])
      suggests.set(input, [...(suggests.get(input) ?? []), name])
  for (const input of inputs) {
    if (!(toolInputs as readonly string[]).includes(input))
      problems.push(
        `draft_context takes "${input}", which src/domain/proposal-attributes.ts does not list in toolInputs. List it, and name it in the inputs of the attributes it suggests.`,
      )
    else if (!suggests.has(input) && !Object.hasOwn(toolControls, input))
      problems.push(
        `draft_context takes "${input}", but no attribute names it in its inputs and it is no tool control. Name it in the inputs of the attributes it suggests in src/domain/proposal-attributes.ts.`,
      )
  }
  for (const input of [...suggests.keys(), ...Object.keys(toolControls)])
    if (!inputs.includes(input))
      problems.push(
        `src/domain/proposal-attributes.ts names the tool input "${input}", which draft_context no longer takes. Remove it there.`,
      )
  // The tool may suggest only what it is classified to suggest: never a default or what people decide.
  for (const [input, names] of suggests)
    for (const name of names) {
      const spec = registry[name]!.agent
      const asks = (spec as { asks?: readonly string[] }).asks ?? []
      if (spec.treatment === 'defaulted' || spec.treatment === 'never_inferred')
        problems.push(
          `The tool input "${input}" suggests "${name}", which draft_context treats as ${spec.treatment}: an agent must never set it. Remove the input, or change the treatment on purpose (a product decision, FR-121).`,
        )
      else if (spec.treatment === 'derived' && !asks.length)
        problems.push(
          `The tool input "${input}" suggests "${name}", which Heed derives and never asks for. Remove the input, or let the person confirm it through a question.`,
        )
    }
  return problems
}

/** Each treatment's marks are the ones it can carry, and asking is only for what may be asked. */
export function treatmentProblems(registry: Registry = proposalAttributes): string[] {
  const allowed: Record<AgentTreatment, readonly string[]> = {
    derived: ['derived', 'prefilled', 'confirmed'],
    defaulted: ['default'],
    prefilled: ['prefilled', 'confirmed', 'default'],
    never_inferred: ['not_inferred'],
  }
  const problems: string[] = []
  for (const [name, spec] of Object.entries(registry)) {
    const { treatment, marks } = spec.agent
    for (const mark of marks)
      if (!(fieldMarks as readonly string[]).includes(mark) || !allowed[treatment].includes(mark))
        problems.push(
          `"${name}" is ${treatment} but may carry the mark "${mark}". A ${treatment} attribute carries only ${allowed[treatment].join(', ')}.`,
        )
    const marked = isMarked(name as ProposalAttribute)
    if (marked && !marks.length)
      problems.push(
        `"${name}" carries a mark (markedFields in src/domain/proposal-rules.ts) but lists none it may carry.`,
      )
    if (!marked && marks.length)
      problems.push(
        `"${name}" lists marks but carries none: add it to markedFields in src/domain/proposal-rules.ts, or drop the marks.`,
      )
    const asks = (spec.agent as { asks?: readonly string[] }).asks ?? []
    if (asks.length && (treatment === 'defaulted' || treatment === 'never_inferred'))
      problems.push(
        `draft_context asks the person for "${name}", which it treats as ${treatment}. Only a derived or prefilled attribute may be asked.`,
      )
    if (asks.length && !(marks as readonly string[]).includes('confirmed'))
      problems.push(`"${name}" may be asked, so its marks must include "confirmed".`)
  }
  return problems
}
