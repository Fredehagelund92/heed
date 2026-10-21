import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { itemKinds } from '@domain/item'
import { AgentGets, CaveatField } from '@/components/context/caveat-field'
import { EvidenceFields, WhyWeAsk } from '@/components/context/context-fields'
import {
  caveatStarters,
  caveatWords,
  examplesPlaceholder,
  kindHelp,
  sourceWords,
  whyWeAsk,
} from '@/lib/context-help'
import { contextFormFindings, formValues } from '@/lib/context-form'

const { rawEmpty: _raw, ...shownCaveatWords } = caveatWords
const allWords = [
  ...Object.values(sourceWords),
  ...Object.values(shownCaveatWords),
  ...Object.values(whyWeAsk),
  ...caveatStarters.map((starter) => starter.label),
  ...itemKinds.flatMap((kind) => [
    kindHelp[kind].sources,
    ...kindHelp[kind].quotes,
    kindHelp[kind].caveat,
  ]),
]

describe('the help for where it comes from and what not to conclude', () => {
  it('gives every kind two quotes and a line of what not to conclude of its own', () => {
    for (const kind of itemKinds) {
      const help = kindHelp[kind]
      expect(help.quotes).toHaveLength(2)
      expect(new Set([...help.quotes, help.caveat]).size).toBe(3)
    }
    const quotes = itemKinds.flatMap((kind) => kindHelp[kind].quotes)
    expect(new Set(quotes).size).toBe(quotes.length)
    const caveats = itemKinds.map((kind) => kindHelp[kind].caveat)
    expect(new Set(caveats).size).toBe(caveats.length)
  })

  it('keeps every example within what the service stores', () => {
    for (const kind of itemKinds) {
      for (const quote of kindHelp[kind].quotes) expect([...quote].length).toBeLessThanOrEqual(500)
      expect([...kindHelp[kind].caveat].length).toBeLessThanOrEqual(120)
    }
  })

  it('uses plain words: no em dash, no ids, no schema names', () => {
    for (const words of allWords) {
      expect(words).not.toMatch(/—/)
      expect(words).not.toMatch(/notToConclude|not_to_conclude|evidence|claim level|fact_only/i)
      expect(words).not.toMatch(/\b(?:caveat|misread|scope)\b/i)
    }
  })

  it('keeps every sentence of what not to conclude to 16 words or fewer', () => {
    const sentences = [
      ...Object.values(caveatWords),
      ...itemKinds.map((kind) => kindHelp[kind].caveat),
    ].flatMap((words) => words.split(/(?<=[.!?])\s+/))
    for (const sentence of sentences)
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(16)
  })

  it('shows two examples in one placeholder', () => {
    expect(examplesPlaceholder(['One.', 'Two.'])).toBe('For example: "One." or "Two."')
  })

  it('starts empty and optional: no line is needed', () => {
    expect(formValues().notToConclude).toBe('')
    const empty = { ...formValues(), notToConclude: ' ' }
    expect(contextFormFindings(empty).find((f) => f.field === 'notToConclude')).toBeUndefined()
  })
})

describe('CaveatField', () => {
  function Harness({ initial = '' }: { initial?: string }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <h2 id="caveat-title">{caveatWords.title}</h2>
        <CaveatField
          id="caveat"
          labelledBy="caveat-title"
          value={value}
          onChange={setValue}
          onBlur={() => {}}
          kind="event"
          itemTitle="Norway closure"
          claimLevel="fact_only"
          disabled={false}
        />
      </>
    )
  }

  it('says how agents use the line, in plain sight, and shows the kind example', () => {
    render(<Harness />)
    const box = screen.getByRole('textbox', { name: caveatWords.title })
    expect(box).toHaveValue('')
    expect(box).not.toHaveAttribute('placeholder')
    expect(box).toHaveAccessibleDescription(caveatWords.help)
    expect(screen.getByText(caveatWords.how)).toBeVisible()
    expect(screen.getByText(`“${kindHelp.event.caveat}”`, { exact: false })).toBeVisible()
    expect(screen.getByRole('figure', { name: caveatWords.card })).toHaveTextContent(
      caveatWords.empty,
    )
  })

  it('puts a starter in the box after what is there, with the caret after it', async () => {
    render(<Harness initial="Lower orders do not mean fewer customers." />)
    const box = screen.getByRole('textbox', { name: caveatWords.title })
    await userEvent.click(screen.getByRole('button', { name: caveatStarters[2].label }))
    expect(box).toHaveValue(`Lower orders do not mean fewer customers. ${caveatStarters[2].text}`)
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.keyboard('Finance first.')
    expect(box).toHaveValue('Lower orders do not mean fewer customers. Check with Finance first.')
  })

  it('uses the example for an empty box, and adds it after a line already written', async () => {
    render(<Harness />)
    const box = screen.getByRole('textbox', { name: caveatWords.title })
    await userEvent.click(screen.getByRole('button', { name: 'Use this example' }))
    expect(box).toHaveValue(kindHelp.event.caveat)
    const card = screen.getByRole('figure', { name: caveatWords.card })
    expect(card).toHaveTextContent(`${caveatWords.title}: ${kindHelp.event.caveat}`)
  })

  it('follows the box as the person types, without a save', async () => {
    render(<Harness />)
    await userEvent.type(
      screen.getByRole('textbox', { name: caveatWords.title }),
      'It does not tell you why.',
    )
    expect(screen.getByRole('figure', { name: caveatWords.card })).toHaveTextContent(
      'What not to conclude: It does not tell you why.',
    )
  })
})

describe('AgentGets', () => {
  it('shows the field as the app receives it, on request', async () => {
    render(<AgentGets title="Norway closure" line="Do not compare." claimLevel="fact_only" />)
    const toggle = screen.getByRole('button', { name: caveatWords.showRaw })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/"not_to_conclude"/)).not.toBeVisible()
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: caveatWords.hideRaw })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByText(/"not_to_conclude"/).closest('pre')).toHaveTextContent(
      '"not_to_conclude": "Do not compare."',
    )
  })

  it('says nothing is sent for an empty line, by the claim level', async () => {
    const { rerender } = render(<AgentGets title="" line={null} claimLevel="fact_only" />)
    expect(screen.getByText(caveatWords.untitled)).toBeVisible()
    expect(screen.getByText(caveatWords.empty)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: caveatWords.showRaw }))
    expect(screen.getByText(caveatWords.rawEmpty)).toBeVisible()
    rerender(<AgentGets title="" line={null} claimLevel="effect_stated" />)
    expect(screen.getByText(caveatWords.emptyStated)).toBeVisible()
  })
})

describe('EvidenceFields', () => {
  const empty = [{ url: '', quote: '', date: '' }]
  const renderFields = (kind: (typeof itemKinds)[number]) =>
    render(
      <EvidenceFields
        kind={kind}
        value={empty}
        onChange={() => {}}
        error={() => undefined}
        disabled={false}
        onBlur={() => {}}
      />,
    )

  it('names the three parts in plain words and describes the quote as a copied sentence', () => {
    renderFields('event')
    expect(screen.getByRole('textbox', { name: 'Link to the source' })).toHaveAccessibleDescription(
      kindHelp.event.sources,
    )
    const quote = screen.getByRole('textbox', { name: 'A sentence copied from the source' })
    expect(quote).toHaveAttribute('placeholder', examplesPlaceholder(kindHelp.event.quotes))
    expect(quote).toHaveAccessibleDescription(expect.stringContaining(sourceWords.quoteHelp))
    expect(screen.getByText('0 of 500 characters')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Date you read it' })).toBeVisible()
  })

  it('follows the kind with its examples', () => {
    renderFields('issue')
    expect(
      screen.getByRole('textbox', { name: 'A sentence copied from the source' }),
    ).toHaveAttribute('placeholder', examplesPlaceholder(kindHelp.issue.quotes))
    expect(screen.getByText(kindHelp.issue.sources)).toBeVisible()
  })
})

describe('WhyWeAsk', () => {
  it('opens the reason for its section', async () => {
    render(<WhyWeAsk topic="source" section={sourceWords.title} />)
    await userEvent.click(screen.getByRole('button', { name: 'Why we ask: Where this comes from' }))
    expect(await screen.findByText(whyWeAsk.source)).toBeVisible()
  })
})
