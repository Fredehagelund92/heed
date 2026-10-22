import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectRequest, Session } from '@/api'
import { describeApiError, isSignedOut, toApiError } from '@/api/errors'
import { connectRequestQuery, queryKeys, sessionQuery, useApiWrite } from '@/api/queries'
import {
  CheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { PersonAvatar } from '@/components/person-avatar'
import { AuthPage } from '@/components/sign-in/auth-page'
import { SignInMethods } from '@/components/sign-in/sign-in-form'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clientOrigin, scopeWords } from '@/lib/connections'
import { productName } from '@/lib/brand'

/*
  The consent screen of an AI agent sign-in (FR-403, docs/ai-sign-in.md). The person's own AI agent
  sent them here from the login server; they sign in if they have not, read which app asks and
  what it may do, and allow or deny. The answer sends the browser back to the app. It stands
  outside the shell, like the signed-out page, and never inside another page's frame, so a
  hidden page cannot trick a person into pressing Allow.
*/

const framed = () => {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

export function ApprovePage({ requestId }: { requestId: string | undefined }) {
  return (
    <AuthPage title="Connect an AI agent">
      {framed() ? (
        <Notice title="This page can't open here">
          For your safety, {productName} shows this page only in its own browser tab. Go back to
          your AI agent and connect again.
        </Notice>
      ) : requestId ? (
        <SignedIn requestId={requestId} />
      ) : (
        <Notice title="This sign-in link isn't complete">
          Go back to your AI agent and connect to {productName} again. It opens this page with a new
          link.
        </Notice>
      )}
    </AuthPage>
  )
}

/** A heading and a sentence or two: every state of the page that asks nothing of the person. */
function Notice({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" data-slot="approve-notice">
      <h2 className="text-title font-bold">{title}</h2>
      <p className="text-body text-muted-foreground">{children}</p>
      {action ? <div>{action}</div> : null}
    </section>
  )
}

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-control-lg w-full" />
      <Skeleton className="h-control-lg w-full" />
    </div>
  )
}

function SignedIn({ requestId }: { requestId: string }) {
  const session = useQuery({ ...sessionQuery(), retry: false })
  if (session.isPending) return <Loading />
  if (session.isError) {
    if (isSignedOut(session.error)) return <SignInStep />
    return (
      <Notice
        title={`We couldn't reach ${productName}`}
        action={
          <Button variant="outline" onClick={() => void session.refetch()}>
            Try again
          </Button>
        }
      >
        Nothing was decided. Check the connection and try again.
      </Notice>
    )
  }
  return <Consent requestId={requestId} session={session.data} />
}

/**
 * The identity connector's sign-in, the same methods as the sign-in page. Locally it is the dev
 * connector's demo people; a company sign-in adds its own button (docs/ai-sign-in.md).
 */
function SignInStep() {
  return (
    <section className="flex flex-col gap-6" data-slot="approve-sign-in">
      <div className="flex flex-col gap-2">
        <h2 className="text-title font-bold tracking-title">Sign in to {productName}</h2>
        <p className="text-body text-muted-foreground">
          An AI agent asked to connect to {productName} as you. Sign in first, then decide whether
          to allow it.
        </p>
      </div>
      <SignInMethods />
    </section>
  )
}

function Problem({ error }: { error: unknown }) {
  const { title, description } = describeApiError(error)
  return (
    <Alert variant="danger">
      <CircleAlertIcon />
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </AlertContent>
    </Alert>
  )
}

function Consent({ requestId, session }: { requestId: string; session: Session }) {
  const request = useQuery({ ...connectRequestQuery(requestId), retry: false })
  if (request.isPending) return <Loading />
  if (request.isError)
    return (
      <Notice
        title="We couldn't load this sign-in"
        action={
          <Button variant="outline" onClick={() => void request.refetch()}>
            Try again
          </Button>
        }
      >
        Nothing was decided. Check the connection and try again.
      </Notice>
    )
  if (!request.data) return <Ended />
  return <ConsentForm requestId={requestId} request={request.data} session={session} />
}

function Ended() {
  return (
    <Notice title="This sign-in has ended">
      It was answered already, it waited longer than ten minutes, or it was started in another
      browser. Go back to your AI agent and connect to {productName} again.
    </Notice>
  )
}

function ConsentForm({
  requestId,
  request,
  session,
}: {
  requestId: string
  request: ConnectRequest
  session: Session
}) {
  const decide = useApiWrite('decideConnectRequest')
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState<'allowed' | 'denied' | null>(null)
  const answer = (allow: boolean) =>
    decide.mutate(
      { id: requestId, allow },
      {
        onSuccess: (result) => {
          setLeaving(allow ? 'allowed' : 'denied')
          window.location.assign(result.redirectTo)
        },
        onError: (error) => {
          if (toApiError(error).kind === 'not-found')
            queryClient.setQueryData(queryKeys.connectRequest(requestId), null)
        },
      },
    )
  if (leaving)
    return (
      <Notice title={leaving === 'allowed' ? 'Connected' : 'Not connected'}>
        {leaving === 'allowed'
          ? `Returning you to ${request.clientName}. You can close this tab if it stays open.`
          : `${request.clientName} can't use ${productName} as you. Returning you to the app.`}
      </Notice>
    )
  return (
    <section className="flex flex-col gap-6" data-slot="approve-consent">
      <div className="flex flex-col gap-2">
        <h2 className="text-title font-bold wrap-anywhere">
          Allow {request.clientName} to use {productName} as you?
        </h2>
        <p className="text-body text-muted-foreground">{clientOrigin(request)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-dense font-bold text-muted-foreground" id="approve-scopes">
          It will be able to
        </h3>
        <ul aria-labelledby="approve-scopes" className="divide-y rounded-lg border">
          {request.scopes.map((scope) => (
            <li key={scope} className="flex gap-3 px-4 py-3">
              <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-status-success-icon" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-body font-bold">{scopeWords[scope].title}</span>
                <span className="text-dense text-muted-foreground">{scopeWords[scope].detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="flex gap-2 text-dense text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
          It sees only what you can see, and it can never accept or share anything. You can
          disconnect it at any time in Connect an agent.
        </p>
      </div>
      <div className="flex items-center gap-3 text-dense text-muted-foreground">
        <PersonAvatar person={session.person} size="sm" />
        <span className="min-w-0 truncate">
          Signed in as <span className="font-bold text-foreground">{session.person.name}</span>
        </span>
      </div>
      {decide.isError && toApiError(decide.error).kind !== 'not-found' ? (
        <Problem error={decide.error} />
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={decide.isPending} onClick={() => answer(true)}>
          {decide.isPending && decide.variables?.allow ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          Allow
        </Button>
        <Button variant="outline" disabled={decide.isPending} onClick={() => answer(false)}>
          Deny
        </Button>
      </div>
      <p className="flex gap-2 text-dense text-muted-foreground">
        <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        Allow only an AI agent you just asked to connect. If you didn&apos;t, choose Deny.
      </p>
    </section>
  )
}
