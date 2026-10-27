import * as z from 'zod/mini'

/**
 * The people of a workspace as Heed v1 has them (docs/product.md, section 11; FR-804, FR-417): two
 * roles, Admin and Member, and ownership on each domain, as Settings, People and a domain's page
 * change them. An administrator grant is Admin; everyone else is a Member. The earlier roles
 * (auditor, approver) stay in the data for history and are not offered here.
 */
export const memberRoleSchema = z.enum(['admin', 'member'])

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const personId = z.string().check(z.uuid())

/** One person in the workspace: their role, the domains they own and when they last signed in. */
export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  /** The domains they own now, by id, in name order. */
  owns: z.array(z.string()),
  /** The last time they signed in; null if never. */
  lastSignedInAt: z.nullable(z.string()),
})

export const setRoleSchema = z.strictObject({ personId, role: memberRoleSchema })
export const memberIdSchema = z.strictObject({ personId })

/** A removal, named by the batch its ended roles share, so Undo puts back exactly those. */
export const memberRemovedSchema = z.object({ removed: z.literal(true), batchId: z.string() })

/** The domains a removal waits on: the person is their only owner. */
export const soleOwnerSchema = z.object({ areas: z.array(z.string()) })

/** The owners of a domain, all of them: those not named stop owning it, those named start. */
export const setOwnersSchema = z.strictObject({
  areaId,
  personIds: z.array(personId).check(z.maxLength(200)),
})
export const ownersSetSchema = z.object({
  areaId: z.string(),
  owners: z.array(z.string()),
  /** Whether anything changed: the same owners again change nothing. */
  changed: z.boolean(),
})

/** The most addresses one invite step takes. */
export const INVITE_BATCH_MAX = 50
/** How long an invite link works, from when it was last sent. */
export const INVITE_DAYS = 7

const email = z.email().check(z.maxLength(320), z.toLowerCase())

/** Invite people by address: a role, and the domains they own from the start (FR-417). */
export const createInvitesSchema = z.strictObject({
  emails: z.array(email).check(z.minLength(1), z.maxLength(INVITE_BATCH_MAX)),
  role: memberRoleSchema,
  areaIds: z.array(areaId).check(z.maxLength(50)),
})

/** An open invite, as the People page lists it. Never its link: that goes only to its sender. */
export const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  areaIds: z.array(z.string()),
  invitedBy: z.string(),
  sentAt: z.string(),
  expiresAt: z.string(),
  /** Past its expiry: sending it again gives it a new link and a new expiry. */
  expired: z.boolean(),
})

/**
 * What happened to each address, in the order given: invited (with the link to share), already in
 * the workspace, or already invited (send that invite again instead).
 */
export const invitesCreatedSchema = z.object({
  results: z.array(
    z.union([
      z.object({
        email: z.string(),
        outcome: z.literal('invited'),
        invite: inviteSchema,
        link: z.string(),
      }),
      z.object({ email: z.string(), outcome: z.literal('member'), personId: z.string() }),
      z.object({ email: z.string(), outcome: z.literal('pending'), invite: inviteSchema }),
    ]),
  ),
})

export const inviteIdSchema = z.strictObject({ id: z.string().check(z.uuid()) })
/** An invite sent again: the new link, which replaces the old one. */
export const inviteResentSchema = z.object({ invite: inviteSchema, link: z.string() })

export type MemberRole = z.infer<typeof memberRoleSchema>
export type Member = z.infer<typeof memberSchema>
export type SetOwnersInput = z.infer<typeof setOwnersSchema>
export type OwnersSet = z.infer<typeof ownersSetSchema>
export type CreateInvitesInput = z.infer<typeof createInvitesSchema>
export type Invite = z.infer<typeof inviteSchema>
export type InvitesCreated = z.infer<typeof invitesCreatedSchema>
export type InviteResent = z.infer<typeof inviteResentSchema>
export type MemberRemoved = z.infer<typeof memberRemovedSchema>
