import { usePageTitle } from '@/lib/page-title'
import { ChevronRightIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import { Logo } from '@/components/heed/logo'
import { ProfileLabel } from '@/components/heed/profile-label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { useQuery } from '@tanstack/react-query'
import {
  installQuery,
  inviteQuery,
  signInMethodQuery,
  signInPeopleQuery,
  useApiWrite,
  workspaceQuery,
} from '@/api/queries'
import { Button } from '@/components/ui/button'
import { useRoute } from '@/lib/router'
import { PRODUCT } from '@/lib/brand'
import { cn } from '@/lib/utils'

/** Why a company sign-in came back without signing in, as the screen says it. */
const refusalWords = (reason: string, provider: string): string | null =>
  ({
    cancelled: `Signing in was cancelled at ${provider}. Try again when you're ready.`,
    expired: 'That sign-in took too long, or was started in another browser. Start again here.',
    unavailable: `We couldn't reach ${provider}. Try again in a minute.`,
    failed: `${provider}'s answer didn't pass our checks. Try again, or tell an admin.`,
    email_unverified: `${provider} hasn't confirmed your email address. Confirm it there, then try again.`,
    not_allowed: "This account can't sign in here. Ask an admin for an invite.",
  })[reason] ?? null

/** What an invite link opens, in one line: "You're invited as a Member, owning Sales." */
function InviteLine({ token }: { token: string }) {
  const note = useQuery(inviteQuery(token))
  if (note.isPending) return null
  if (!note.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        This invite link doesn't work any more. Ask whoever invited you for a new one.
      </p>
    )
  const owned = note.data.domains
  return (
    <p role="status" className="text-sm">
      You're invited as {note.data.admin ? 'an Admin' : 'a Member'}
      {owned.length ? `, owning ${owned.join(' and ')}` : ''}. Sign in as {note.data.email}.
    </p>
  )
}

/** The logo, and under it the label that names this install when one is set. */
function SignInMark() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Logo className="h-8" />
      {/* Room for the whole label here, unlike in a page's header. */}
      <ProfileLabel className="max-w-full" />
    </div>
  )
}

/**
 * Says the demo is invented, under the sign-in card. Only on the demo (HEED_AUTH=demo, or the demo
 * loaded): an install with its own data, a private profile on the dev picker say, never says so.
 */
function DemoNote() {
  if (!useQuery(installQuery()).data?.demo) return null
  return (
    <p className="px-6 text-center text-xs text-balance text-muted-foreground">
      Larchwood Outdoor is an invented company. Every name, fact and number here is mock data.
    </p>
  )
}

/**
 * Sign-in as the login-03 block lays it out. With the company's provider (OIDC), one button that
 * goes there and comes back signed in; an invite link names its invite first, and a sign-in that
 * came back refused says why. In a demo, or in development, the person picker.
 */
export function SignInPage() {
  usePageTitle('Sign in')
  const method = useQuery(signInMethodQuery())
  const install = useQuery(installQuery())
  const query = useRoute().query
  const token = query.get('invite')
  // Nothing until the service says how it signs people in and what this install is, so neither
  // the picker nor the demo's note flashes.
  if (method.isPending || install.isPending) return null
  if (method.data?.kind !== 'oidc') return <PickerSignIn token={token} />
  const provider = method.data
  const refused = refusalWords(query.get('error') ?? '', provider.name)
  const start = `${provider.start}?returnTo=${encodeURIComponent('/#/inbox')}`
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <SignInMark />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in to {PRODUCT}</CardTitle>
            <CardDescription>With your company account.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {token && <InviteLine token={token} />}
              {refused && (
                <p role="alert" className="text-sm text-destructive">
                  {refused}
                </p>
              )}
              <Button nativeButton={false} render={<a href={start} />} className="w-full">
                Sign in with {provider.name}
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
        <DemoNote />
      </div>
    </main>
  )
}

/** More people than this, and the picker lays them out in two columns on a wide screen. */
const ONE_COLUMN = 6

// The person picker, of a demo or of development. A long list of people takes two columns on a
// wide screen, so they stay in view without scrolling.
function PickerSignIn({ token }: { token: string | null }) {
  const wide = (useQuery(signInPeopleQuery()).data?.length ?? 0) > ONE_COLUMN
  const demo = useQuery(installQuery()).data?.demo
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className={cn('flex w-full max-w-sm flex-col gap-6', wide && 'sm:max-w-2xl')}>
        <SignInMark />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in to {PRODUCT}</CardTitle>
            <CardDescription>
              {demo ? 'This is a demo. Pick who you are.' : 'Pick who you are.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {token && <InviteLine token={token} />}
              <PeoplePicker columns={wide ? 2 : 1} />
            </FieldGroup>
          </CardContent>
        </Card>
        <DemoNote />
      </div>
    </main>
  )
}

/** The demo's people, one button each: a press signs in as them. */
function PeoplePicker({ columns = 1 }: { columns?: 1 | 2 }) {
  const signIn = useApiWrite('signIn')
  const offered = useQuery(signInPeopleQuery()).data ?? []
  // Signed out on the service, nobody's workspace can be read: the picker shows names alone.
  const people = useQuery(workspaceQuery()).data?.people ?? []
  return (
    <ItemGroup className={cn('gap-2', columns === 2 && 'sm:grid sm:grid-cols-2')}>
      {offered.map((name) => {
        const role = people.find((x) => x.name === name)?.role
        return (
          <div role="listitem" key={name}>
            <Item
              variant="outline"
              size="sm"
              render={
                <button
                  type="button"
                  // Signed in, the app moves on (App.tsx). Not from here: while the shell loads the
                  // person's workspace this page is unmounted, so a callback of this click would
                  // never run.
                  onClick={() => signIn.mutate({ name })}
                />
              }
              className="w-full text-left hover:bg-muted"
            >
              <ItemMedia>
                <PersonAvatar name={name} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{name}</ItemTitle>
                {role && <ItemDescription>{role}</ItemDescription>}
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
              </ItemActions>
            </Item>
          </div>
        )
      })}
    </ItemGroup>
  )
}

/**
 * How this workspace signs people in, for a page that asks for it on the way somewhere (an agent's
 * consent page): the company's provider, which brings the person back to `returnTo`, or in a demo
 * the people to pick from.
 */
export function SignInChoices({ returnTo }: { returnTo: string }) {
  const method = useQuery(signInMethodQuery())
  if (method.isPending) return null
  if (method.data?.kind !== 'oidc') return <PeoplePicker />
  const start = `${method.data.start}?returnTo=${encodeURIComponent(returnTo)}`
  return (
    <Button nativeButton={false} render={<a href={start} />} className="w-full">
      Sign in with {method.data.name}
    </Button>
  )
}
