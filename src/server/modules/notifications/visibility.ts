/**
 * Which outbox events a person may see, as SQL over `o` (an `outbox_events` row). It runs inside
 * the reader's transaction, so row security decides for proposals: the proposer, the area's
 * owners and deputies and administrators see a proposal's events, and everyone sees an
 * accepted one. Item events (source flags and stale links) follow the library: whoever may read
 * the item's current version, and nobody while that version is limited to groups. Gap events
 * (a gap verified by test) are for the gap's managers: administrators and the area's owners and
 * deputies. Edition and vocabulary events are for every signed-in person; inbox events only for
 * the inbox's owner. A deleted domain (FR-814) is for administrators and the people it told: the
 * authors of what it moved, withdrew or left as a draft, and its team. Any other kind of subject
 * stays hidden until it gets a rule here.
 */
export const visibleEvent = `(
  (o.aggregate_type = 'proposal' and exists (select 1 from proposals p
    where p.id = (case when o.aggregate_type = 'proposal' then o.aggregate_id end)::uuid))
  or (o.aggregate_type = 'item' and exists (select 1 from v_item_list l
    join item_versions v on v.id = l.version_id
    where l.id = o.aggregate_id and cl_audience_allows(l.audience_groups)))
  or (o.aggregate_type = 'gap' and (cl_is_admin_now() or cl_is_owner_now(o.area_id)))
  or o.aggregate_type in ('edition', 'vocabulary')
  or (o.aggregate_type = 'area' and (cl_is_admin_now() or exists (select 1 from inbox_items i
    where i.event_seq = o.seq and i.person_id = cl_person())))
  or (o.aggregate_type = 'inbox' and o.aggregate_id = cl_person()::text))`

/** The subject's title, when the reader may still see the subject (row security applies). */
export function subjectTitle(type: string, id: string): string {
  return `coalesce((select p.draft->>'title' from proposals p
    where ${type} = 'proposal' and p.id = (case when ${type} = 'proposal' then ${id} end)::uuid),
    (select l.title from v_item_list l where ${type} = 'item' and l.id = ${id}
      and cl_audience_allows(l.audience_groups)
      and exists (select 1 from item_versions v where v.id = l.version_id)),
    (select t.name from serving_vocabulary((select seq from live_edition)) t
      where ${type} = 'vocabulary' and t.key = ${id}),
    (select a.name from areas a where ${type} = 'area' and a.id = ${id}))`
}

/**
 * What the reviewer wrote with a request for changes or a rejection: the reason of the latest
 * decision on the proposal up to the inbox item, read under the reader's row security, so a
 * reader who may not read the proposal's activity gets none.
 */
export function decisionNote(item: string): string {
  return `(select e.data->>'reason' from proposal_events e
    where ${item}.kind = 'proposal.decided' and ${item}.subject_type = 'proposal'
      and ${item}.payload->>'state' in ('changes_requested', 'rejected')
      and e.proposal_id = (case when ${item}.subject_type = 'proposal' then ${item}.subject_id end)::uuid
      and e.kind = 'decided' and e.at <= ${item}.created_at
    order by e.at desc, e.id desc limit 1)`
}

/** The person who acted, by name; erased people are not named. */
export function actorJson(column: string): string {
  return `(select json_build_object('id', a.id::text, 'name', a.display_name) from people a
    where a.id = ${column} and a.erased_at is null)`
}

/** A timestamp column as ISO 8601 in UTC, with milliseconds. */
export function iso(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}
