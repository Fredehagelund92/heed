import * as React from 'react'
import { MailIcon, SearchIcon, UserPlusIcon } from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PersonAvatar } from '@/components/heed/bits'
import { Frame, FrameSection } from '@/components/heed/frame'
import { DomainDot, TagChip } from '@/components/heed/tag-chip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DomainId } from '@/model/items'
import { emailOf, listOf, partyActions, type Allowed, type Party } from '@/model/people'
import { useIsMobile } from '@/hooks/use-mobile'
import { domainHue } from '@/lib/tones'
import { arriveRef, leaveThen, useLeavingRows } from '@/lib/presence'
import { href, setQuery, useRoute } from '@/lib/router'
import { useReported } from '@/lib/reported'
import { useQuery } from '@tanstack/react-query'
import type { Invited } from '@/api/client'
import { toApiError } from '@/api/errors'
import { activityQuery, useSession, useWrite } from '@/api/queries'
import { useDomainList, useDomains, useInvites, usePeople } from '@/lib/workspace'
import { useMe } from '@/lib/workspace'

// Settings > People: everyone in the workspace, as v1 has them. Two roles (admin, member); owning a
// domain is not a role but a domain chip, and it lives on the domain, so the People page and a
// domain page always agree. Everyone signed in can read, ask, flag and suggest; owners publish and
// check their domain's context; admins change roles, invite and remove.

/** Admin or member, as a quiet chip. */
function RoleChip({ admin }: { admin: boolean }) {
  return <TagChip tone={admin ? 'term' : 'neutral'}>{admin ? 'Admin' : 'Member'}</TagChip>
}

/** The domains someone owns, or an invite will own, as domain chips. */
function OwnedChips({ owns }: { owns: DomainId[] }) {
  const domains = useDomains()
  const owned = owns.filter((d) => domains[d])
  if (!owned.length) return <span className="text-sm text-muted-foreground">No domain</span>
  return (
    <span className="flex flex-wrap gap-1">
      {owned.map((d) => (
        <TagChip
          key={d}
          tone="domain"
          hue={domainHue(d)}
          icon={<DomainDot id={d} className="size-2" />}
        >
          {domains[d]?.name}
        </TagChip>
      ))}
    </span>
  )
}

/** Why a control is locked, or nothing when it can be used. */
const lockOf = (a: Allowed) => (a === 'can' ? undefined : a.locked)

/** The name someone goes by here: a member's name, an invite's address. */
const nameOf = (p: Party) => (p.kind === 'member' ? p.name : p.email)

/** A control someone may not use, kept visible, with why on hover or focus. */
function Locked({ reason, children }: { reason?: string; children: React.ReactElement }) {
  if (!reason) return children
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

/** Invite people: their addresses, a role, and the domains they own from the start. */
const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast('Copied'),
    () => toast('Copy this link', { description: text }),
  )

/**
 * What inviting did, as a toast: the link to send each person (Heed sends no email yet), and who
 * was left out because they are here or invited already.
 */
function toastInvited({ links, skipped }: Invited) {
  const left = skipped.length
    ? ` ${skipped.map((s) => s.email).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} here or invited already.`
    : ''
  if (!links.length) {
    toast('Nobody new to invite', { description: left.trim() })
    return
  }
  toast(links.length === 1 ? 'Invited' : `Invited ${links.length} people`, {
    description: `Send ${links.length === 1 ? 'them the link' : 'each their link'} to sign in. It works for 7 days.${left}`,
    action: {
      label: links.length === 1 ? 'Copy link' : 'Copy links',
      onClick: () =>
        void copy(
          links.length === 1
            ? links[0]!.link
            : links.map((l) => `${l.email}: ${l.link}`).join('\n'),
        ),
    },
  })
}

export function InviteDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  preset?: DomainId
}) {
  const me = useMe()
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const write = useWrite()
  const [text, setText] = React.useState('')
  const inviting = useReported<Invited>({
    wasnt: 'Nobody was invited.',
    done: (invited) => {
      toastInvited(invited)
      setText('')
      onOpenChange(false)
    },
  })
  const [admin, setAdminRole] = React.useState(false)
  const [owns, setOwns] = React.useState<DomainId[]>(preset ? [preset] : [])
  const emails = text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
  const bad = emails.filter((e) => !valid(e))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            They can read, ask, flag and suggest from the start. Owners publish and check their
            domain's context.
          </DialogDescription>
        </DialogHeader>
        <form
          id="invite-form"
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!emails.length || bad.length) return
            inviting.act(() => write('invite', { emails, admin, owns }))
          }}
        >
          <Field>
            <FieldLabel htmlFor="invite-emails">Email addresses</FieldLabel>
            <Textarea
              id="invite-emails"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="maria@larchwood.example, kofi@larchwood.example"
              aria-invalid={bad.length > 0}
              className="min-h-20"
            />
            <FieldDescription>
              {bad.length
                ? `Not an address: ${bad.join(', ')}`
                : 'Separate several with commas or new lines.'}
            </FieldDescription>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Role</FieldLegend>
            <RadioGroup
              value={admin ? 'admin' : 'member'}
              onValueChange={(v) => setAdminRole(v === 'admin')}
              className="gap-2"
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="member" id="invite-member" />
                <FieldLabel htmlFor="invite-member" className="font-normal">
                  Member
                </FieldLabel>
              </Field>
              <Locked reason={me.admin ? undefined : 'Only an admin can invite an admin'}>
                <Field orientation="horizontal">
                  <RadioGroupItem value="admin" id="invite-admin" disabled={!me.admin} />
                  <FieldLabel htmlFor="invite-admin" className="font-normal">
                    Admin, who also changes Settings
                  </FieldLabel>
                </Field>
              </Locked>
            </RadioGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Owner of</FieldLegend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Domains they own">
              {domainIds.map((d) => {
                const on = owns.includes(d)
                const allowed = me.admin || me.owns.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={!allowed}
                    title={allowed ? undefined : 'Only its owners and admins add owners'}
                    onClick={() => setOwns(on ? owns.filter((x) => x !== d) : [...owns, d])}
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border px-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 aria-pressed:border-ring aria-pressed:bg-muted"
                  >
                    <DomainDot id={d} />
                    {domains[d]?.name}
                  </button>
                )
              })}
            </div>
          </FieldSet>
          {inviting.problem && (
            <p role="alert" className="text-sm text-destructive">
              {inviting.problem}
            </p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="invite-form"
            disabled={!emails.length || bad.length > 0 || inviting.state === 'sending'}
          >
            {inviting.state === 'sending'
              ? 'Inviting…'
              : emails.length > 1
                ? `Invite ${emails.length} people`
                : 'Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Someone from a row. A member: their role, the domains they own (a switch each), what they did
 * lately, and removing them. An invite: the role and domains it was sent with, a new link, and
 * taking it back. What may be done is the service's rule (partyActions).
 */
function PersonSheet({ p, onOpenChange }: { p: Party | null; onOpenChange: (o: boolean) => void }) {
  const me = useMe()
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const write = useWrite()
  const mobile = useIsMobile()
  const [removing, setRemoving] = React.useState(false)
  const member = p?.kind === 'member' ? p : null
  const recent = useQuery({ ...activityQuery(member?.name ?? ''), enabled: !!member }).data ?? []
  if (!p) return null
  const can = partyActions(p, me, domains)
  const name = nameOf(p)
  const email = p.kind === 'member' ? emailOf(p) : p.email
  const invited = p.kind === 'invite'
  const { owners } = can
  const alone = typeof can.leave === 'object' && 'handOver' in can.leave ? can.leave.handOver : []
  const leave =
    typeof can.leave === 'object' && 'locked' in can.leave ? can.leave.locked : undefined
  return (
    <Sheet open={!!p} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="gap-0 data-[side=bottom]:max-h-bottom-sheet-tall data-[side=right]:max-w-md"
      >
        <SheetHeader className="flex-row items-center gap-3 border-b pr-12">
          <PersonAvatar name={name} size={32} />
          <div className="min-w-0">
            <SheetTitle className="truncate">{name}</SheetTitle>
            <SheetDescription className="truncate">{email}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {p.kind === 'invite' && can.resend !== 'absent' && (
            <section className="flex flex-wrap items-center gap-2 border-b p-4 text-sm">
              <MailIcon aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">Invited, not signed in yet.</span>
              <Locked reason={lockOf(can.resend)}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={can.resend !== 'can'}
                  onClick={() =>
                    void write('resendInvite', { id: p.id }).then(({ link }) =>
                      toast('New invite link', {
                        description: `${p.email}. The old link stops working; send them this one.`,
                        action: { label: 'Copy link', onClick: () => void copy(link) },
                      }),
                    )
                  }
                >
                  Make a new link
                </Button>
              </Locked>
            </section>
          )}
          <section className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <p className="text-sm font-medium">Role</p>
              <p className="text-xs text-muted-foreground">
                {invited
                  ? `Invited as ${p.admin ? 'an Admin' : 'a Member'}. An invite keeps the role it was sent with.`
                  : p.admin
                    ? 'Admins change Settings, invite and remove people.'
                    : 'Members read, ask, flag and suggest.'}
              </p>
            </div>
            {p.kind === 'member' && can.role !== 'absent' && (
              <Locked reason={lockOf(can.role)}>
                <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Role">
                  {(['Member', 'Admin'] as const).map((r) => {
                    const on = (r === 'Admin') === p.admin
                    return (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={can.role !== 'can'}
                        onClick={() =>
                          void write('setAdmin', { id: p.id, admin: r === 'Admin' }).then(() =>
                            toast(`${p.name} is ${r === 'Admin' ? 'an admin' : 'a member'} now`),
                          )
                        }
                        className="h-7 rounded-sm px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed aria-checked:bg-muted aria-checked:font-medium"
                      >
                        {r}
                      </button>
                    )
                  })}
                </div>
              </Locked>
            )}
          </section>
          {p.kind === 'member' && owners !== 'absent' ? (
            <section className="border-b p-4">
              <p className="text-sm font-medium">Owner of</p>
              <p className="mb-2 text-xs text-muted-foreground">
                An owner publishes and checks the context in their domain.
              </p>
              <ul className="flex flex-col">
                {domainIds.map((d) => {
                  const allowed = owners[d] ?? 'can'
                  const id = `own-${d}`
                  return (
                    <li key={d} className="flex min-h-10 items-center gap-2">
                      <DomainDot id={d} />
                      <label htmlFor={id} className="flex-1 text-sm">
                        {domains[d]?.name}
                      </label>
                      <Locked reason={lockOf(allowed)}>
                        <Switch
                          id={id}
                          checked={p.owns.includes(d)}
                          disabled={allowed !== 'can'}
                          onCheckedChange={(v) => {
                            void write('setOwner', { id: p.id, domain: d, own: v }).then(
                              (result) => {
                                if (!result.done)
                                  toast(`${domains[d]?.name} needs an owner`, {
                                    description: 'Add another owner first, then take this one off.',
                                  })
                              },
                            )
                          }}
                        />
                      </Locked>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : (
            p.kind === 'invite' && (
              <section className="border-b p-4">
                <p id="person-will-own" className="text-sm font-medium">
                  Owns once they sign in
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  An invite keeps the domains it was sent with.
                </p>
                <div role="group" aria-labelledby="person-will-own">
                  <OwnedChips owns={p.willOwn} />
                </div>
              </section>
            )
          )}
          <section className="p-4">
            <p id="person-lately" className="text-sm font-medium">
              Lately
            </p>
            {recent.length ? (
              <ul
                aria-labelledby="person-lately"
                className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground"
              >
                {recent.map((r) => (
                  <li key={r.what} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{r.what}</span>
                    <span className="shrink-0 tabular-nums">{r.when}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {p.kind === 'invite'
                  ? 'Nothing yet.'
                  : `Last active ${(p.lastActive ?? 'a while ago').toLowerCase()}.`}
              </p>
            )}
          </section>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t p-4">
          <Locked reason={leave}>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={!!leave}
              onClick={() => setRemoving(true)}
            >
              {invited ? 'Revoke the invite' : 'Remove from the workspace'}
            </Button>
          </Locked>
        </div>
        <Dialog open={removing} onOpenChange={setRemoving}>
          <DialogContent>
            {alone.length ? (
              <>
                <DialogHeader>
                  <DialogTitle>Hand over first</DialogTitle>
                  <DialogDescription>
                    {name} is the only owner of {alone.map((d) => domains[d]?.name).join(' and ')}.
                    Add another owner there, then remove them.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button
                    nativeButton={false}
                    render={<a href={href(`/settings/domains/${alone[0]}`)} />}
                  >
                    Open {domains[alone[0]!]?.name}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {invited ? `Revoke the invite to ${name}?` : `Remove ${name}?`}
                  </DialogTitle>
                  <DialogDescription>
                    {p.kind === 'invite'
                      ? 'Their invite link stops working.'
                      : `They can't sign in any more. What they published stays, signed with their name${p.owns.length ? `, and the other owners of ${p.owns.map((d) => domains[d]?.name).join(' and ')} carry on` : ''}.`}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setRemoving(false)
                      onOpenChange(false)
                      const undo = (token: string) => ({
                        label: 'Undo',
                        onClick: () => void write('undo', { token }),
                      })
                      // The row goes as it leaves the list, and comes back if they stay. What
                      // happened is said once the service has answered; Undo brings them back in.
                      void leaveThen(p.id, () =>
                        (p.kind === 'invite'
                          ? write('revokeInvite', { id: p.id }).then((r) =>
                              toast('Invite revoked', { description: name, action: undo(r.undo) }),
                            )
                          : write('removePerson', { id: p.id }).then((r) => {
                              if (!r.removed) {
                                const names = r.alone.map((d) => domains[d]?.name ?? d)
                                toast('Hand over first', {
                                  description: `${name} is the only owner of ${listOf(names)}. Add another owner there, then remove them.`,
                                })
                                return
                              }
                              toast('Removed', { description: name, action: undo(r.undo) })
                            })
                        ).catch((e: unknown) =>
                          toast(
                            invited
                              ? `Couldn't revoke the invite to ${name}`
                              : `Couldn't remove ${name}`,
                            { description: toApiError(e).message },
                          ),
                        ),
                      )
                    }}
                  >
                    {invited ? 'Revoke' : 'Remove'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}

export function People() {
  const me = useMe()
  const people = usePeople()
  const invites = useInvites()
  const { fresh } = useSession()
  const [q, setQ] = React.useState('')
  const [inviting, setInviting] = React.useState(false)
  const parties: Party[] = [
    ...people.map((p) => ({ kind: 'member' as const, ...p })),
    ...invites.map((i) => ({ kind: 'invite' as const, ...i })),
  ]
  // Search everywhere opens a member's sheet with ?person= and their name; the sheet open is
  // anyone's, by id.
  const asked = useRoute().query.get('person')
  const askedId = asked ? (people.find((p) => p.name === asked)?.id ?? null) : null
  const [open, setOpen] = React.useState<string | null>(askedId)
  const [lastAsked, setLastAsked] = React.useState(asked)
  if (asked !== lastAsked) {
    setLastAsked(asked)
    if (askedId) setOpen(askedId)
  }
  const close = () => {
    setOpen(null)
    if (asked) setQuery({ person: undefined })
  }
  // A new install has only the person who set it up.
  const everyone = fresh ? parties.filter((p) => p.kind === 'member' && p.id === me.id) : parties
  const shown = everyone.filter((p) =>
    `${nameOf(p)} ${p.kind === 'member' ? emailOf(p) : ''}`
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  )
  const invited = shown.filter((p) => p.kind === 'invite')
  const active = shown.filter((p) => p.kind === 'member')
  const current = parties.find((p) => p.id === open) ?? null
  const leaving = useLeavingRows()

  const row = (p: Party) => (
    <li key={p.id} data-leaving={leaving.has(p.id) || undefined} className="row-presence">
      <button
        type="button"
        onClick={() => setOpen(p.id)}
        className="grid w-full grid-cols-(--cols-around) items-center gap-x-3 gap-y-1.5 border-t px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:px-5 @3xl/main:grid-cols-(--cols-people)"
      >
        <PersonAvatar name={nameOf(p)} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {nameOf(p)}
            {p.kind === 'member' && p.id === me.id && (
              <span className="font-normal text-muted-foreground"> (you)</span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {p.kind === 'member' ? emailOf(p) : p.email}
          </span>
        </span>
        <span className="justify-self-end @3xl/main:justify-self-start">
          <RoleChip admin={p.admin} />
        </span>
        {/* On a phone the row is a card: the domains and when on a line of their own. */}
        <span className="col-span-3 col-start-2 @3xl/main:col-span-1 @3xl/main:col-start-auto">
          <OwnedChips owns={p.kind === 'member' ? p.owns : p.willOwn} />
        </span>
        <span className="col-span-3 col-start-2 text-xs text-muted-foreground @3xl/main:col-span-1 @3xl/main:col-start-auto @3xl/main:text-right">
          {p.kind === 'invite' ? <TagChip tone="warn">Invited</TagChip> : p.lastActive}
        </span>
      </button>
    </li>
  )

  return (
    <Frame>
      <FrameSection
        title="People"
        description="Everyone here can read, ask, flag and suggest. Owners publish and check their domain's context; admins change Settings."
        action={
          <Locked reason={me.admin ? undefined : 'Only an admin invites people'}>
            <Button size="sm" disabled={!me.admin} onClick={() => setInviting(true)}>
              <UserPlusIcon data-icon="inline-start" />
              Invite people
            </Button>
          </Locked>
        }
      >
        {everyone.length > 8 && (
          <div className="relative border-t px-4 py-3 md:px-5">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-6.5 size-3.5 -translate-y-1/2 text-muted-foreground md:left-7.5"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="h-8 max-w-xs pl-8"
            />
          </div>
        )}
        <div className="hidden grid-cols-(--cols-people) gap-x-3 border-t px-4 py-2 text-xs text-muted-foreground md:px-5 @3xl/main:grid">
          <span className="w-7" aria-hidden />
          <span>Name</span>
          <span>Role</span>
          <span>Owner of</span>
          <span className="text-right">Last active</span>
        </div>
        <ul ref={arriveRef} aria-label="People">
          {active.map(row)}
        </ul>
        {invited.length > 0 && (
          <>
            <p
              className={cn(
                'border-t px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground md:px-5',
              )}
            >
              Invited {invited.length}
            </p>
            <ul ref={arriveRef} aria-label="Invited">
              {invited.map(row)}
            </ul>
          </>
        )}
        {!shown.length && (
          <p className="border-t p-4 text-sm text-muted-foreground md:px-5">
            Nobody matches “{q.trim()}”.
          </p>
        )}
        {fresh && (
          <p className="border-t p-4 text-sm text-muted-foreground md:px-5">
            Just you so far. Invite the people who own a part of the business, so they can publish
            its context.
          </p>
        )}
      </FrameSection>
      <InviteDialog key={String(inviting)} open={inviting} onOpenChange={setInviting} />
      <PersonSheet p={current} onOpenChange={(o) => !o && close()} />
    </Frame>
  )
}
