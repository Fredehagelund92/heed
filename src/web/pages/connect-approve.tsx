import { usePageTitle } from '@/lib/page-title'
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectionScope } from '@contract/connections'
import { toApiError, type ConnectRequest } from '@/api'
import { connectRequestQuery, sessionQuery, useApiWrite } from '@/api/queries'
import { PersonAvatar } from '@/components/heed/bits'
import { Logo } from '@/components/heed/logo'
import { CheckIcon, ShieldCheckIcon, TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PRODUCT } from '@/lib/brand'
import { navigate, useRoute } from '@/lib/router'
import { SignInChoices } from '@/pages/signin'

/*
  The consent page of an agent's sign-in (FR-403, docs/ai-sign-in.md). The person's own agent sent
  them here from the login server with `?request=`: they sign in if they have not, read which agent
  asks and what it may do, and allow or deny. The answer sends the browser back to the agent. It
  stands outside the shell, as the sign-in page does, and never inside another page's frame, so a
  hidden page cannot trick a person into pressing Allow.
*/

/** What each permission lets an agent do, as the person reads it before they allow it. */
const scopeWords: Record<ConnectionScope, { title: string; detail: string }> = {
  read: {
    title: 'Read context',
    detail: 'Read the context items you can see, to answer your questions about the numbers.',
  },
  feedback: {
    title: 'Report what is missing or wrong',
    detail: "Tell the owners when context is missing, wrong or unclear. Your name isn't sent.",
  },
  propose: {
    title: 'Suggest changes',
    detail:
      'Send suggestions in your name, after you say yes. The owner of the domain checks each one before agents get it.',
  },
}

/** How the person can tell which agent asks, and where the answer sends them. */
const originWords = (request: ConnectRequest) =>
  `${
    request.clientKind === 'document'
      ? `The agent describes itself at ${request.clientHost}.`
      : `The agent registered itself with ${PRODUCT}.`
  } You go back to ${request.redirectHost} when you answer.`

/** A phone's finger needs 44px: the answers fill the row there, side by side. */
const phoneTarget = 'max-md:h-11 max-md:flex-1'

const framed = () => {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

export function ConnectApprovePage() {
  usePageTitle('Connect an agent')
  const { query } = useRoute()
  const requestId = query.get('request')
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo className="h-8 self-center" />
        {framed() ? (
          <Notice title="This page can't open here">
            For your safety, this page opens only in its own browser tab. Go back to your agent and
            connect again.
          </Notice>
        ) : requestId ? (
          <Asked requestId={requestId} />
        ) : (
          <Notice title="This sign-in link isn't complete">
            Go back to your agent and connect again. It opens this page with a new link.
          </Notice>
        )}
      </div>
    </main>
  )
}

/** A heading and a sentence or two: every state of the page that asks nothing of the person. */
function Notice({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  )
}

function Asked({ requestId }: { requestId: string }) {
  const session = useQuery(sessionQuery())
  const { path, query } = useRoute()
  if (session.isPending) return <Waiting />
  if (!session.data?.user)
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            <h1>Sign in to {PRODUCT}</h1>
          </CardTitle>
          <CardDescription>
            An agent asked to connect as you. Sign in first, then decide whether to allow it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInChoices returnTo={`${path}?${query.toString()}`} />
        </CardContent>
      </Card>
    )
  return <Consent requestId={requestId} person={session.data.user} />
}

function Waiting() {
  return (
    <Card role="status" aria-label="Loading">
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-1/2" />
      </CardContent>
    </Card>
  )
}

function Consent({ requestId, person }: { requestId: string; person: string }) {
  const request = useQuery(connectRequestQuery(requestId))
  // Answered, the page says so while the browser goes back to the agent; the request has ended.
  const [left, setLeft] = React.useState<{ allowed: boolean; agent: string } | null>(null)
  if (left)
    return (
      <Notice title={left.allowed ? 'Connected' : 'Not connected'}>
        {left.allowed
          ? `Returning you to ${left.agent}. You can close this tab if it stays open.`
          : `${left.agent} can't use ${PRODUCT} as you. Returning you to the agent.`}
      </Notice>
    )
  if (request.isPending) return <Waiting />
  if (request.isError)
    return (
      <Notice
        title="We couldn't load this sign-in"
        action={
          <Button variant="outline" className={phoneTarget} onClick={() => void request.refetch()}>
            Try again
          </Button>
        }
      >
        Nothing was decided. Check the connection and try again.
      </Notice>
    )
  if (!request.data) return <Ended />
  return (
    <Decide
      requestId={requestId}
      request={request.data}
      person={person}
      onAnswered={(allowed) => setLeft({ allowed, agent: request.data!.clientName })}
    />
  )
}

function Ended() {
  return (
    <Notice title="This sign-in has ended">
      It was answered already, it waited longer than ten minutes, or it was started in another
      browser. Go back to your agent and connect again.
    </Notice>
  )
}

function Decide({
  requestId,
  request,
  person,
  onAnswered,
}: {
  requestId: string
  request: ConnectRequest
  person: string
  onAnswered: (allowed: boolean) => void
}) {
  const answer = useApiWrite('answerConnectRequest')
  const queryClient = useQueryClient()
  // An answer, or one the service no longer waits for, ends the request: opened again, the page
  // says so.
  const end = () => queryClient.setQueryData(connectRequestQuery(requestId).queryKey, null)
  const decide = (allow: boolean) =>
    answer.mutate(
      { id: requestId, allow },
      {
        onSuccess: ({ redirectTo }) => {
          onAnswered(allow)
          end()
          // The agent's own address; a page of this app (the demo's) opens in the app.
          if (redirectTo.startsWith('/')) navigate(redirectTo)
          else window.location.assign(redirectTo)
        },
        onError: (error) => {
          if (toApiError(error).kind === 'not-found') end()
        },
      },
    )
  const failed = answer.isError ? toApiError(answer.error) : null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl wrap-anywhere">
          <h1>
            Allow {request.clientName} to use {PRODUCT} as you?
          </h1>
        </CardTitle>
        <CardDescription>{originWords(request)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-labelledby="consent-can" className="flex flex-col gap-2">
          <h2 id="consent-can" className="text-sm font-medium text-muted-foreground">
            It will be able to
          </h2>
          <ul className="divide-y rounded-lg border">
            {request.scopes.map((scope) => (
              <li key={scope} className="flex gap-3 px-4 py-3">
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-good-icon" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{scopeWords[scope].title}</span>
                  <span className="text-sm text-muted-foreground">{scopeWords[scope].detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="flex gap-2 text-sm text-muted-foreground">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            It sees only what you can see, and it can never publish anything. You can disconnect it
            at any time in Settings, under Agents and access.
          </p>
        </section>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PersonAvatar name={person} size={20} />
          <span className="min-w-0 truncate">
            Signed in as <span className="font-medium text-foreground">{person}</span>
          </span>
        </div>
        {failed && failed.kind !== 'not-found' && (
          <p role="alert" className="text-sm text-destructive">
            {failed.message}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            className={phoneTarget}
            loading={answer.isPending && answer.variables?.allow === true}
            loadingLabel="Allowing…"
            disabled={answer.isPending}
            onClick={() => decide(true)}
          >
            Allow
          </Button>
          <Button
            variant="outline"
            className={phoneTarget}
            loading={answer.isPending && answer.variables?.allow === false}
            loadingLabel="Denying…"
            disabled={answer.isPending}
            onClick={() => decide(false)}
          >
            Deny
          </Button>
        </div>
        <p className="flex gap-2 text-sm text-muted-foreground">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Allow only an agent you just asked to connect. If you didn&apos;t, choose Deny.
        </p>
      </CardContent>
    </Card>
  )
}
