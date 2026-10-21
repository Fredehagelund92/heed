import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Session, SignInPerson } from '@/api'
import { describeApiError, toApiError } from '@/api/errors'
import { signInPeopleQuery, useSignIn } from '@/api/queries'
import {
  Building2Icon,
  CircleAlertIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { PersonAvatar } from '@/components/person-avatar'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldHeader, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  initialChoice,
  rememberChoice,
  signInDomains,
  signInGroups,
  signInOtherRoles,
  signInRoleDomains,
  signInRoles,
  type SignInRole,
} from '@/lib/sign-in'
import { productName } from '@/lib/brand'

/*
  How a person signs in to Heed. Two methods can be offered, each only when it is set up:

  - Company sign-in, the identity connector a deployment runs. Not built yet (docs/ai-sign-in.md,
    README "company sign-in"): the `company` slot holds its one button, and renders nothing until
    a connector passes it.
  - The local sign-in, the dev identity connector's demo people. The service refuses it when
    NODE_ENV=production, so a production install never lists anyone here; the group says so,
    so nobody mistakes it for the real sign-in.

  One filled button: the company button when there is one, else Continue as the chosen person.
*/

/** The company identity connector's entry point, once one is configured. */
export type CompanySignIn = { href: string }

export function SignInMethods({
  company,
  onSignedIn,
}: {
  company?: CompanySignIn
  /** After the session has replaced any earlier one in the cache. */
  onSignedIn?: (session: Session) => void
}) {
  const people = useQuery(signInPeopleQuery())
  const signIn = useSignIn()
  if (people.isPending) return <SignInLoading />
  if (people.isError) return <SignInLoadFailed onRetry={() => void people.refetch()} />
  return (
    <SignInChoices
      people={people.data}
      company={company}
      pending={signIn.isPending}
      error={signIn.isError ? signIn.error : null}
      onSignIn={(email) =>
        signIn.mutate(email, {
          onSuccess: (session) => {
            rememberChoice(email)
            onSignedIn?.(session)
          },
        })
      }
    />
  )
}

/** The methods themselves, for a list of people already loaded. Stories render it directly. */
export function SignInChoices({
  people,
  company,
  pending = false,
  error = null,
  onSignIn,
}: {
  people: readonly SignInPerson[]
  company?: CompanySignIn
  pending?: boolean
  error?: unknown
  onSignIn: (email: string) => void
}) {
  const groups = useMemo(() => signInGroups(people), [people])
  const [chosen, setChosen] = useState(() => initialChoice(groups.flatMap((group) => group.people)))
  const person = people.find((p) => p.email === chosen) ?? null
  if (!people.length && !company)
    return (
      <SignInNotice title="No one can sign in here yet">
        This install of {productName} has no sign-in set up: no company account and no demo people.
        Ask the people who run {productName} to set one up.
      </SignInNotice>
    )
  return (
    <div className="flex flex-col gap-6" data-slot="sign-in-methods">
      {company ? (
        <div className="flex flex-col gap-6" data-slot="sign-in-company">
          <Button size="lg" className="w-full" render={<a href={company.href} />}>
            <Building2Icon />
            Continue with your company account
          </Button>
          {people.length ? <Divider>or try {productName} as a demo person</Divider> : null}
        </div>
      ) : null}
      {people.length ? (
        <form
          className="flex flex-col gap-4"
          data-slot="sign-in-demo"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            if (person && !pending) onSignIn(person.email)
          }}
        >
          <Field className="gap-3">
            <FieldHeader>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>Sign in as</FieldLabel>
                <Badge form="outline" size="sm" icon={FlaskConicalIcon} quiet>
                  Demo
                </Badge>
              </div>
              <FieldDescription>Each person sees the app with their own roles.</FieldDescription>
            </FieldHeader>
            <Select value={chosen} onValueChange={(value) => setChosen(value)} disabled={pending}>
              <SelectTrigger
                size="rich"
                data-slot="sign-in-person"
                onKeyDown={(event) => {
                  // Enter on the closed field signs in, as in any form with one field: the person
                  // is already chosen. Space and the arrow keys still open the list.
                  if (event.key !== 'Enter' || event.currentTarget.ariaExpanded === 'true') return
                  event.preventDefault()
                  event.preventBaseUIHandler()
                  event.currentTarget.closest('form')?.requestSubmit()
                }}
              >
                <SelectValue placeholder="Choose a person">
                  {person ? <PersonSummary person={person} /> : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="motion-reduce:animate-none">
                {groups.map((group) => (
                  <SelectGroup key={group.role}>
                    <SelectLabel>{group.title}</SelectLabel>
                    {group.people.map((p) => (
                      <SelectItem key={p.email} value={p.email} className="gap-3">
                        <PersonOption person={p} role={group.role} />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            type="submit"
            size="lg"
            variant={company ? 'outline' : 'default'}
            className="w-full"
            disabled={!person || pending}
          >
            {pending ? (
              <>
                <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
                Signing in
              </>
            ) : (
              <span
                key={person?.email}
                className="min-w-0 truncate duration-instant motion-safe:animate-in motion-safe:fade-in-0"
              >
                {person ? `Continue as ${person.name}` : 'Continue'}
              </span>
            )}
          </Button>
          <p role="status" className="sr-only">
            {pending && person ? `Signing in as ${person.name}` : ''}
          </p>
          {error ? <SignInProblem error={error} /> : null}
          <p className="flex gap-2 text-caption text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
            Demo people exist on local and demo installs only. In production you sign in with your
            company account.
          </p>
        </form>
      ) : null}
    </div>
  )
}

/**
 * The person as the picker shows them: a neutral avatar, the name, and under it their roles and
 * the domains those roles are in, each domain with its own mark.
 */
function PersonSummary({ person }: { person: SignInPerson }) {
  const domains = signInDomains(person)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3" data-slot="sign-in-person-summary">
      <PersonAvatar person={person} decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="min-w-0 truncate text-body text-foreground">{person.name}</span>
        {/* As high as a small badge, so every person's summary has the same height. */}
        <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-2">
          <span className="text-caption text-muted-foreground">{signInRoles(person)}</span>
          {domains.map((area) => (
            <DomainBadge key={area.id} name={area.name} label={area.label} size="sm" />
          ))}
        </span>
      </span>
    </span>
  )
}

/**
 * One person in the list, on one line under the heading of the role they are listed under: a
 * small avatar, the name, the domains of that role beside it, and any other role they hold.
 */
function PersonOption({ person, role }: { person: SignInPerson; role: SignInRole }) {
  const others = signInOtherRoles(person, role)
  return (
    <>
      <PersonAvatar person={person} size="sm" decorative />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <SelectItemText className="text-body">{person.name}</SelectItemText>
        {signInRoleDomains(person, role).map((area) => (
          <DomainBadge key={area.id} name={area.name} label={area.label} size="sm" />
        ))}
        {others ? <span className="text-caption text-muted-foreground">and {others}</span> : null}
      </span>
    </>
  )
}

/** A hairline with words in the middle, between two ways to sign in. */
function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-caption text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/** The sign-in page's heading, and the one sentence of what Heed is for. */
export function SignInIntro() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-title font-bold tracking-title text-balance">Sign in to {productName}</h1>
      <p className="text-body text-pretty text-muted-foreground">
        Facts about your numbers, written by your team, checked by the owner of each domain, and
        read by your AI agents.
      </p>
    </div>
  )
}

export function SignInLoading() {
  return (
    <div role="status" aria-label="Loading the sign-in" className="flex flex-col gap-4">
      <Skeleton className="h-control-lg w-full" />
      <Skeleton className="h-control-lg w-full" />
    </div>
  )
}

export function SignInLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <SignInNotice
      title="We couldn't load the sign-in"
      action={
        <Button variant="outline" size="lg" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {productName} didn&apos;t answer. Check your connection and try again.
    </SignInNotice>
  )
}

/** A heading and a sentence or two, with what to do next when there is something. */
function SignInNotice({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" data-slot="sign-in-notice">
      <h2 className="text-large font-bold tracking-large">{title}</h2>
      <p className="text-body text-muted-foreground">{children}</p>
      {action ? <div>{action}</div> : null}
    </section>
  )
}

function SignInProblem({ error }: { error: unknown }) {
  // The service refuses someone it no longer offers with a 401, which is not "signed out" here.
  const { title, description } =
    toApiError(error).kind === 'signed-out'
      ? {
          title: `${productName} didn't sign you in`,
          description: 'This person is no longer offered. Reload the page and choose again.',
        }
      : describeApiError(error)
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
