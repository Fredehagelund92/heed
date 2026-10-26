import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { describeApiError } from '@/api'
import { connectQuery } from '@/api/queries'
import { ChevronDownIcon, CircleAlertIcon, InfoIcon, PlugIcon } from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ConnectCard } from '@/components/connect/connect-card'
import { ConnectedApps } from '@/components/connect/connected-apps'
import { HelpLink } from '@/components/help/help-link'
import { CopyBlock } from '@/components/try-it/copy-block'
import {
  appNameFor,
  askHeedFirst,
  snippetFor,
  TOKEN_PLACEHOLDER,
  toolsInWords,
} from '@/lib/connect'
import { toolName } from '@/lib/gateway'
import { usePermissions } from '@/lib/use-session'
import { cn } from '@/lib/utils'
import { productName } from '@/lib/brand'

/*
  Connect your AI (Home board; navigation decision, 12 October 2026): a section of the person's
  own Settings, from Home's quick action and the user menu. How a person uses these facts in their
  own AI client: the address, a snippet to paste for each client that may connect today, every
  tool an agent can get (the ones switched off marked Off), and what to do next. With the login
  server on (FR-403, docs/ai-sign-in.md), a client that can sign in asks the person to sign in to
  Heed and allow it, and the person's connected agents are listed here with Disconnect; any other
  client sends a token the data platform team gives out.
*/

function Section({
  title,
  help,
  level = 'h3',
  children,
  className,
}: {
  title: string
  /** The setup by hand's steps sit under its heading, as h3; a section of its own is an h2. */
  level?: 'h2' | 'h3'
  /** A help link beside the title. */
  help?: ReactNode
  children: ReactNode
  className?: string
}) {
  const Heading = level
  return (
    <section className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading className="text-body font-bold">{title}</Heading>
        {help ? <span className="text-caption">{help}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Loading() {
  return (
    <div data-slot="connect-loading" className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

export function ConnectSection() {
  const info = useQuery(connectQuery())
  const { isFor } = usePermissions()
  const admin = isFor('administrators')

  if (info.isPending)
    return (
      <>
        <span role="status" className="sr-only">
          Loading how to connect.
        </span>
        <Loading />
      </>
    )
  if (info.isError)
    return (
      <Alert variant="danger" data-slot="connect-error">
        <CircleAlertIcon />
        <AlertContent>
          <AlertTitle>We couldn&apos;t load how to connect</AlertTitle>
          <AlertDescription>{describeApiError(info.error).description}</AlertDescription>
          <Button variant="outline" className="w-fit" onClick={() => void info.refetch()}>
            Try again
          </Button>
        </AlertContent>
      </Alert>
    )

  const { address, clients, tools, signIn } = info.data
  const gateway = admin ? (
    <p className="text-dense text-muted-foreground">
      You choose which agents can connect, and which tools they get, in{' '}
      <Link
        to="/admin"
        search={{ section: 'gateway' }}
        className="text-brand-ink underline underline-offset-4 hover:no-underline"
      >
        MCP and gateway
      </Link>
      .
    </p>
  ) : null

  if (!address)
    return (
      <div data-slot="connect" className="flex flex-col gap-4">
        <Empty data-state="connect-off" className="flex-none border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>Agents can&apos;t connect here yet</EmptyTitle>
            <EmptyDescription>Ask the data team when they can.</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {gateway}
      </div>
    )

  return (
    <div data-slot="connect" className="flex min-w-0 flex-col gap-6">
      <p className="text-dense">
        Your AI agent can check these facts before it answers a question about company data. It gets
        the same facts you see in{' '}
        <Link
          to="/try-it"
          className="text-brand-ink underline underline-offset-4 hover:no-underline"
        >
          Try a question
        </Link>
        . <HelpLink to="mcp">What is MCP?</HelpLink>
      </p>

      <ConnectCard address={address} clients={clients} signIn={signIn} />

      {signIn ? (
        <Section title="Your connected agents" level="h2">
          <p className="text-dense text-muted-foreground">
            The agents you allowed to act as you. Each reads only what you can read. Disconnect one
            and it stops working at once.
          </p>
          <ConnectedApps />
        </Section>
      ) : null}

      <div data-slot="connect-by-hand" className="flex min-w-0 flex-col gap-3 border-t pt-6">
        <h2 className="text-body font-bold">Set it up by hand</h2>
        <p className="text-dense text-muted-foreground">
          The same steps as the prompt, one at a time, for an agent that doesn&apos;t take a prompt.
        </p>
        {signIn ? (
          <Alert variant="info" data-slot="connect-sign-in">
            <InfoIcon />
            <AlertContent>
              <AlertTitle>Sign in from your agent</AlertTitle>
              <AlertDescription>
                Add the address below to an agent that can sign in. The first time, it opens{' '}
                {productName} in your browser. Sign in and allow it, and it acts as you. An agent
                that can&apos;t sign in needs an access key from the data team.
              </AlertDescription>
            </AlertContent>
          </Alert>
        ) : (
          <Alert variant="info" data-slot="connect-sign-in">
            <InfoIcon />
            <AlertContent>
              <AlertTitle>Agents connect with an access key</AlertTitle>
              <AlertDescription>
                Here, agents can&apos;t sign in by themselves. Ask the data team for an access key.
              </AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </div>

      <Section title="The address">
        <CopyBlock text={address} label="the address for agents" />
      </Section>

      <Section title="Agents that can connect today">
        {clients.length ? (
          <ul className="flex flex-col gap-4">
            {clients.map((client) => {
              const snippet = snippetFor(client.label, address, signIn ? 'sign-in' : 'token')
              const name = appNameFor(client)
              return (
                <li
                  key={client.label}
                  data-slot="connect-client"
                  className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4"
                >
                  <p className="text-dense font-bold">{name}</p>
                  <p className="text-caption text-muted-foreground">{snippet.where}</p>
                  <CopyBlock text={snippet.code} label={`the setup for ${name}`} />
                  {signIn ? (
                    <Collapsible className="flex flex-col gap-2">
                      <CollapsibleTrigger className="group/token inline-flex w-fit items-center gap-1 rounded-sm text-caption font-bold text-muted-foreground hover:text-foreground">
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="size-icon-sm -rotate-90 transition-transform group-data-panel-open/token:rotate-0"
                        />
                        {"If your agent can't sign in"}
                        <span className="sr-only"> ({name})</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="flex flex-col gap-2">
                        <p className="text-caption text-muted-foreground">
                          Ask the data team for an access key, and use this setup with the key in
                          place of {TOKEN_PLACEHOLDER}.
                        </p>
                        <CopyBlock
                          text={snippetFor(client.label, address, 'token').code}
                          label={`the setup for ${name} with an access key`}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-dense text-muted-foreground">
            No agent is switched on yet. An admin needs to add one first.
          </p>
        )}
      </Section>

      <Section
        title="Ask first"
        help={<HelpLink to="connect-an-agent#ask-first">Why a line?</HelpLink>}
      >
        <p className="text-dense">
          Your agent decides when to check these facts. Add this line to its instructions so it
          checks more often.
        </p>
        <ul data-slot="ask-heed-first" className="flex flex-col gap-4">
          {askHeedFirst.map((line) => (
            <li key={line.label} className="flex min-w-0 flex-col gap-2">
              <p className="text-caption text-muted-foreground">{line.where}</p>
              <CopyBlock text={line.text} label={line.label} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="What it can do"
        help={<HelpLink to="glossary#tool">What is a tool?</HelpLink>}
      >
        <ul
          aria-label="The tools an agent gets"
          className="flex flex-col divide-y rounded-lg border"
        >
          {toolsInWords(tools).map(({ tool, name, about, enabled, personOnly }) => (
            <li
              key={tool}
              data-tool={tool}
              data-state={enabled ? 'on' : 'off'}
              className="flex min-w-0 flex-col gap-1 px-4 py-3"
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-dense font-bold">{name}</span>
                {enabled ? null : (
                  <Badge form="outline" size="sm" quiet>
                    Off
                  </Badge>
                )}
              </span>
              {about ? <span className="text-caption text-muted-foreground">{about}</span> : null}
              {personOnly ? (
                <span className="text-caption text-muted-foreground">
                  It works only in an agent you signed in from, not with an access key. It sends
                  only after you say yes, and the owner checks it before anything changes.
                </span>
              ) : null}
              {enabled ? null : admin ? (
                <span className="text-caption text-muted-foreground">
                  You can switch it on in{' '}
                  <Link
                    to="/admin"
                    search={{ section: 'gateway', tab: 'tools' }}
                    className="text-brand-ink underline underline-offset-4 hover:no-underline"
                  >
                    MCP and gateway, under Tools
                  </Link>
                  .
                </span>
              ) : (
                <span className="text-caption text-muted-foreground">
                  An admin can switch it on.
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="What to do next"
        help={<HelpLink to="connect-an-agent#steps">Step by step</HelpLink>}
      >
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-dense marker:text-muted-foreground">
          {signIn ? (
            <li>
              Paste your agent&apos;s setup from above. When it asks, sign in to {productName} and
              allow it.
            </li>
          ) : (
            <>
              <li>Ask the data team for an access key for your agent.</li>
              <li>
                Paste your agent&apos;s setup from above, with the key in place of{' '}
                {TOKEN_PLACEHOLDER}.
              </li>
            </>
          )}
          <li>Add the line under Ask first to your agent&apos;s instructions.</li>
          <li>
            Ask your agent a question about company data, and look for {toolName('get_context')} as
            it answers: that&apos;s the step where it checks these facts. If it&apos;s not there,
            ask it to check {productName} first.
          </li>
          <li>
            To see what it was told, pick the same metric, market and dates in Try a question.
          </li>
        </ol>
        {signIn ? (
          <p className="text-dense text-muted-foreground">
            An agent that can&apos;t sign in needs an access key from the data team. Use its setup
            under If your agent can&apos;t sign in.
          </p>
        ) : null}
        {gateway}
      </Section>
    </div>
  )
}
