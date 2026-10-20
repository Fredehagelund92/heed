import { useState, type ReactNode } from 'react'
import type { Scope } from '@domain/item'
import { TargetIcon, TextAlignStartIcon, type Icon } from '@/components/icons'
import { MentionText } from '@/components/mentions/mention-text'
import { MentionTextarea } from '@/components/mentions/mention-textarea'
import { ScopeInput } from '@/components/mentions/scope-input'
import { SummaryInput } from '@/components/mentions/summary-input'
import { Page, PageContent } from '@/components/page/page'
import { targetsByKey } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'

/*
  The chip-aware inputs (contract 9.6) in their states, on the mock vocabulary: the scope input,
  the summary with @ mentions and the Markdown body with mention tokens. A screenshot and keyboard
  target until the Add a fact form mounts them.
*/

const filled =
  'Online sales to @[Norway](val:market/norway) stopped on 4 August 2026 after a new customs rule. Compare @[Orders](metric:orders) before and after.'
const long = `${'The text keeps going and a mention counts as its words only. '.repeat(4)}It is too long now, so it says by how much: @[Net revenue](metric:net_revenue) ends here.`
const body =
  '## How to check\n\n1. Compare @[Norway](val:market/norway) with @[Spain](val:market/spain).\n2. Use @[Orders](metric:orders), not the old tool.'

function Field({
  icon: Glyph,
  label,
  hint,
  id,
  children,
}: {
  icon: Icon
  label: string
  hint?: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span id={`${id}-label`} className="flex items-center gap-2 text-body font-bold">
          <Glyph aria-hidden="true" className="size-4 text-muted-foreground" />
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="text-caption text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-large font-bold tracking-large">{title}</h2>
      {children}
    </section>
  )
}

/** One state of a field: a quiet caption, the field, and what it stores. */
function State({
  title,
  stored,
  children,
}: {
  title: string
  stored: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-caption font-bold text-muted-foreground">{title}</h3>
      {children}
      <p className="text-caption text-muted-foreground">
        Stored as{' '}
        <code data-slot="stored" className="font-mono break-all text-foreground">
          {stored || '(nothing)'}
        </code>
      </p>
    </div>
  )
}

function ScopeDemo({ id, title, initial }: { id: string; title: string; initial: Scope }) {
  const [scope, setScope] = useState(initial)
  return (
    <State title={title} stored={JSON.stringify(scope)}>
      <Field
        id={id}
        icon={TargetIcon}
        label="Where it applies"
        hint="Agents use this to decide when to show it. Pick Any value to cover every value of a dimension, or paste a list to add many."
      >
        <ScopeInput
          value={scope}
          onChange={setScope}
          onRequestTerm={() => undefined}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
        />
      </Field>
    </State>
  )
}

function SummaryDemo({ id, title, initial }: { id: string; title: string; initial: string }) {
  const [markup, setMarkup] = useState(initial)
  return (
    <State title={title} stored={markup}>
      <Field
        id={id}
        icon={TextAlignStartIcon}
        label="What happened"
        hint="One or two sentences. Type @ to mention a metric, a market, another item or a domain."
      >
        <SummaryInput
          value={markup}
          onChange={setMarkup}
          onRequestTerm={() => undefined}
          labelledBy={`${id}-label`}
          describedBy={`${id}-hint`}
          placeholder="What happened? Type @ to mention a metric, a market, another item or a domain."
        />
      </Field>
    </State>
  )
}

function BodyDemo() {
  const [text, setText] = useState(body)
  const { targets } = useMentionTargets()
  const lookup = targetsByKey(targets)
  return (
    <Field
      id="body"
      icon={TextAlignStartIcon}
      label="A longer explanation"
      hint="Markdown. Type @ to mention; the mention is written as a token."
    >
      <MentionTextarea
        value={text}
        onChange={setText}
        aria-labelledby="body-label"
        aria-describedby="body-hint"
        className="font-mono text-body"
      />
      <div className="flex flex-col gap-2 rounded-md border border-border p-4 text-body">
        <span className="text-caption font-bold text-muted-foreground">Preview of the text</span>
        <p className="whitespace-pre-wrap">
          <MentionText markup={text} lookup={lookup} />
        </p>
      </div>
    </Field>
  )
}

export function InputsPreview() {
  return (
    <Page title="Inputs">
      <PageContent width="reading" className="flex flex-col gap-12">
        <Section title="Where it applies">
          <ScopeDemo
            id="scope-empty"
            title="Empty"
            initial={{ metrics: [], dimensions: [], dimensionValues: [] }}
          />
          <ScopeDemo
            id="scope-filled"
            title="A metric and a value"
            initial={{
              metrics: ['metric:units_sold'],
              dimensions: [],
              dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
            }}
          />
        </Section>
        <Section title="What happened">
          <SummaryDemo id="summary-empty" title="Empty" initial="" />
          <SummaryDemo id="summary-filled" title="With mentions" initial={filled} />
          <SummaryDemo id="summary-long" title="Over the limit" initial={long} />
        </Section>
        <Section title="A longer explanation">
          <BodyDemo />
        </Section>
        <Section title="Where it applies, any value">
          <ScopeDemo
            id="scope-any-value"
            title="A metric and any value of a dimension"
            initial={{
              metrics: ['metric:orders'],
              dimensions: ['dim:market'],
              dimensionValues: [],
            }}
          />
        </Section>
      </PageContent>
    </Page>
  )
}
