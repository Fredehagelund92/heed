import * as React from 'react'
import { ChevronRightIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import { Logo } from '@/components/heed/logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { useQuery } from '@tanstack/react-query'
import {
  inviteQuery,
  signInMethodQuery,
  signInPeopleQuery,
  useApiWrite,
  workspaceQuery,
} from '@/api/queries'
import { Button } from '@/components/ui/button'
import { navigate, useRoute } from '@/lib/router'
import { PRODUCT } from '@/lib/brand'

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

/**
 * Sign-in as the login-03 block lays it out. With the company's provider (OIDC), one button that
 * goes there and comes back signed in; an invite link names its invite first, and a sign-in that
 * came back refused says why. In a demo, or in development, the person picker.
 */
export function SignInPage() {
  const method = useQuery(signInMethodQuery())
  const query = useRoute().query
  const token = query.get('invite')
  // Nothing until the service says how it signs people in, so the picker never flashes.
  if (method.isPending) return null
  if (method.data?.kind !== 'oidc') return <PickerSignIn token={token} />
  const provider = method.data
  const refused = refusalWords(query.get('error') ?? '', provider.name)
  const start = `${provider.start}?returnTo=${encodeURIComponent('/#/inbox')}`
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo className="h-8 self-center" />
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
      </div>
    </main>
  )
}

// The demo person picker.
function PickerSignIn({ token }: { token: string | null }) {
  const signIn = useApiWrite('signIn')
  const offered = useQuery(signInPeopleQuery()).data ?? []
  // Signed out on the service, nobody's workspace can be read: the picker shows names alone.
  const people = useQuery(workspaceQuery()).data?.people ?? []
  const [fresh, setFresh] = React.useState(false)
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo className="h-8 self-center" />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in to {PRODUCT}</CardTitle>
            <CardDescription>This is a demo. Pick who you are.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {token && <InviteLine token={token} />}
              <ItemGroup className="gap-2">
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
                            onClick={() => {
                              signIn.mutate(
                                { name, fresh },
                                { onSuccess: () => navigate('/inbox') },
                              )
                            }}
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
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or
              </FieldSeparator>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="fresh">Start as a new install</FieldLabel>
                  <FieldDescription>
                    A workspace with no context yet, and the setup checklist in the Inbox.
                  </FieldDescription>
                </FieldContent>
                <Switch id="fresh" checked={fresh} onCheckedChange={setFresh} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <p className="px-6 text-center text-xs text-balance text-muted-foreground">
          Larchwood Outdoor is an invented company. Every name, fact and number here is mock data.
        </p>
      </div>
    </main>
  )
}
