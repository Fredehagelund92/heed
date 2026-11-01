import { ORPCError } from '@orpc/client'
import type { Card, Feed } from '../../../contract/inbox.ts'
import type { ReportOutcome } from '../../../contract/reports.ts'
import {
  alertCardDays,
  alertCardRules,
  cardReaches,
  type AlertCardRule,
  type AlertRuleId,
  type AlertState,
  type RaiseSubject,
} from '../../../domain/alerts.ts'
import { topicScope, topicWords } from '../../../domain/answer.ts'
import { monthWords } from '../../../domain/dates.ts'
import { visibleCount } from '../../../domain/gaps.ts'
import {
  actionGroup,
  byNeed,
  cardKey,
  groupCounts,
  parseCardKey,
  setupSteps,
  type CardAction,
  type SetupStep,
} from '../../../domain/inbox.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { BundleCache } from '../answer/index.ts'
import type { CommentsService } from '../comments/index.ts'
import { syncedOf } from '../connectors/index.ts'
import type { ServingBundle } from '../editions/index.ts'
import type { GapsService } from '../gaps/index.ts'
import { loadProposal, type ReviewPath, type ReviewService } from '../review/index.ts'

/*
  The Inbox of Heed v1 (docs/product.md, section 5): the cards of the domains a person owns (every
  domain for an administrator), made from today's records and grouped by need. Not found: open
  gaps of those domains. Reported: anonymous feedback that said an answer was wrong or unclear,
  until an owner says it is not a problem (decided 26 October 2026), and named reports from Ask,
  with who sent them, until an owner closes one or checks, changes or archives its item (FR-622).
  Mentioned you: threads where a comment mentions the person and they haven't read it,
  whatever domain it is in. Due for a check: live items whose check date passed or whose
  definition changed. Suggestions: those waiting for a decision. Under All, the person's own
  suggestions that wait on an owner, and what was decided in the last two weeks. Saved questions:
  one card for each domain whose saved questions need a look (FR-526).

  Alerts: a card for each raise of an alert rule with a card of its own, for a week. The alert
  rules (FR-621, src/domain/alerts.ts) decide whether an Alert, a Not found, a Saved questions or
  a check-date card reaches the person: not while an administrator turned its rule off, nor in a
  domain the person muted it for.

  Counts from agents are counts only, with no words and no person (FR-602), and a count under the
  minimum is hidden (FR-614).
*/

type Head = { seq: string; label: string; overlay: string }

/** How long a done card stays under Done. */
const doneDays = 14

/** The outcome of a decision, in a word the Inbox shows beside a done card. */
const outcomeWords: Record<string, string> = {
  accept: 'Published',
  // Published without a review round, under the policy the owner set for the agent (FR-421).
  policy: 'Published under your policy',
  request_changes: 'Returned',
  reject: 'Rejected',
  retire: 'Archived',
  // A suggestion to archive that is not archived: closed once its sender took it back.
  close: 'Closed',
  recheck: 'Checked',
  not_a_problem: 'Not a problem',
  not_written: 'Not something we write down',
}

/** What the owners did after a named report, in the word the Inbox shows beside its done card. */
const reportWords: Record<ReportOutcome, string> = {
  not_a_problem: 'Not a problem',
  checked: 'Checked',
  changed: 'Changed',
  archived: 'Archived',
}

/**
 * The context a reported answer gave (FR-618): the items of the delivery the report names, in the
 * order agents got them, each by the title of the very version agents got, and only a version
 * whose audience lets the person read it (never a suggestion's unpublished text). No question and
 * no person: a delivery keeps neither.
 */
const reportedItems = (feedback: string) => `coalesce((
  select jsonb_agg(jsonb_build_object('id', d.id, 'title', iv.title) order by d.rank)
    from deliveries dl
    cross join lateral jsonb_to_recordset(dl.delivered) as d(id text, v int, rank int)
    join item_versions iv on iv.item_id = d.id and iv.version_no = d.v
   where dl.id = ${feedback}.delivery_id and cl_audience_allows(iv.audience_groups)), '[]'::jsonb)`

export function createInboxFeedService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  deps: {
    review: ReviewService
    path: ReviewPath
    gaps: GapsService
    comments: Pick<CommentsService, 'mentionCards' | 'markMentionsRead'>
  },
) {
  async function liveBundle(): Promise<ServingBundle | null> {
    const [head] = await tx.query<Head>(
      `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
         from editions e join live_edition l on l.seq=e.seq`,
    )
    return head ? cache.bundle(tx, head) : null
  }
  async function minimum(): Promise<number> {
    const [row] = await tx.query<{ minimum: number }>(
      `select (value #>> '{}')::int as minimum from settings_current where key='privacy.min_count'`,
    )
    return row?.minimum ?? 5
  }
  /** The domains whose cards land in the person's Inbox: those they own, or every one for an admin. */
  async function domains(): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      `select a.id from areas a where a.archived_at is null
          and (cl_is_admin_now() or cl_is_owner_now(a.id)) order by a.id`,
    )
    return rows.map((r) => r.id)
  }

  async function opened(cards: readonly string[]): Promise<Set<string>> {
    const rows = await tx.query<{ card: string }>(
      'select card from card_reads where person_id=cl_person() and card=any($1::text[])',
      [cards],
    )
    return new Set(rows.map((r) => r.card))
  }

  async function suggestions(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      opened: boolean
      read: boolean
      name: string | null
    }>(
      `select p.id::text, coalesce(p.submitted_at,p.created_at)::text as at,
              exists(select 1 from review_reads r where r.proposal_id=p.id and r.person_id=cl_person()) as opened,
              exists(select 1 from review_reads r where r.proposal_id=p.id and r.person_id=cl_person()
                        and r.read_at is not null and r.item_version_id is not distinct from p.item_version_id) as read,
              (select display_name as name from people where id=p.proposer_id) as name
         from proposals p
        where p.subject='item' and p.state in ('submitted','in_review') and p.discarded_at is null
          and p.area_id=any($1::text[]) and p.action in ('create','change','retire')
        order by coalesce(p.submitted_at,p.created_at) desc limit 100`,
      [areas],
    )
    const cards: Card[] = []
    const synced = await syncedOf(
      tx,
      rows.map((row) => row.id),
    )
    for (const row of rows) {
      const p = await loadProposal(tx, row.id)
      const care = await deps.path.care(p).catch(() => ({ claims: 0, clash: false }))
      cards.push({
        id: cardKey.proposal(p.id),
        group: 'suggestion',
        areaId: p.areaId!,
        at: row.at,
        opened: row.opened,
        done: null,
        proposalId: p.id,
        number: p.number,
        title: p.title,
        action: p.action,
        itemId: p.itemId,
        from: p.proposerId === null ? null : { personId: p.proposerId, name: row.name },
        writtenBy: p.provenance?.by ?? null,
        agent: p.agentName,
        synced: synced.get(p.id) ?? null,
        read: row.read,
        care,
      })
    }
    return cards
  }

  async function gaps(bundle: ServingBundle | null, min: number): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      ref: string
      at: string
      area: string | null
      areas: string[]
      metrics: string[]
      values: string[]
      dimensions: string[]
      month: string | null
      calls: number
      draft: string | null
    }>(
      `select g.id::text, g.ref, g.status_since::text as at, t.area_id as area,
              cl_topic_domains(t.area_id, t.metric_keys) as areas, t.metric_keys as metrics,
              t.value_keys as values, t.dimension_keys as dimensions, t.month::text as month,
              coalesce((select w.reports - w.human_reports + w.no_item_calls from gap_weekly_counts w
                         where w.gap_id=g.id and w.week=date_trunc('week', now() at time zone 'UTC')::date),0)::int as calls,
              (select p.id::text from gap_proposals gp join proposals p on p.id=gp.proposal_id
                where gp.gap_id=g.id and p.discarded_at is null order by p.created_at desc limit 1) as draft
         from gaps g join topics t on t.id=g.topic_id
        where g.status in ('open','proposal_made') and cl_manages_topic(t.area_id, t.metric_keys)
        order by g.status_since desc limit 100`,
    )
    return rows.map((row): Card => {
      const scope = row.month
        ? topicScope({
            metrics: row.metrics,
            values: row.values,
            dimensions: row.dimensions,
            month: row.month,
          })
        : null
      return {
        id: cardKey.gap(row.id),
        group: 'gap',
        areaId: row.area ?? row.areas[0] ?? '',
        at: row.at,
        opened: false,
        done: null,
        gapId: row.id,
        ref: row.ref,
        // What agents asked about, and the month: "Orders in Spain, October 2026".
        title:
          bundle && scope ? `${topicWords(bundle, scope)}, ${monthWords(row.month!)}` : row.ref,
        scope: {
          metrics: row.metrics,
          values: row.values,
          dimensions: row.dimensions,
          month: row.month,
        },
        times: visibleCount(row.calls, min),
        draft: row.draft,
      }
    })
  }

  async function flags(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string
      verdict: 'wrong' | 'unclear'
      note: string | null
      items: { id: string; title: string }[]
    }>(
      `select f.id::text, f.created_hour::text as at, f.area_id as area, f.verdict::text as verdict, f.note,
              ${reportedItems('f')} as items
         from feedback f
        where f.verdict in ('wrong','unclear') and f.area_id=any($1::text[])
          and f.created_hour > now() - interval '90 days'
          and not exists (select 1 from card_states c where c.card='feedback:'||f.id::text)
        order by f.created_hour desc, f.id limit 100`,
      [areas],
    )
    return rows.map((row) => ({
      id: cardKey.feedback(row.id),
      group: 'flag',
      areaId: row.area,
      at: row.at,
      opened: false,
      done: null,
      source: 'agent' as const,
      feedbackId: row.id,
      verdict: row.verdict,
      note: row.note,
      by: null,
      question: null,
      correction: null,
      link: null,
      items: row.items,
    }))
  }

  /**
   * Named reports from Ask (FR-622) in the person's domains, and the figure reports sent to them as
   * an integration's data contact (FR-716), with who sent them: the open ones,
   * which wait until an owner acts, or (`done`) those an owner acted on in the last two weeks. An
   * owner acts by closing it as not a problem, or by checking, changing or archiving its item.
   */
  async function reports(areas: readonly string[], which: 'open' | 'done'): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string
      what: string
      question: string
      correction: string | null
      link: string | null
      by: string
      item: string
      title: string | null
      outcome: ReportOutcome | null
      decided: string | null
    }>(
      `select r.id::text, r.created_at::text as at, r.area_id as area, r.what, r.question, r.correction,
              r.link, r.person_id::text as by, r.item_id as item,
              (select v.title from item_version_service s join item_versions v on v.id = s.version_id
                where s.item_id = r.item_id and cl_audience_allows(v.audience_groups)
                order by lower(s.editions) desc limit 1) as title,
              o.outcome, o.decided_at::text as decided
         from reports r left join lateral cl_report_outcome(r.id) o on true
        where ((r.area_id = any($1::text[]) and r.figure_route is distinct from 'contact')
               or (r.figure_route in ('contact', 'both') and cl_is_figure_contact(r.figure_source)))
          and r.created_at > now() - interval '90 days'
          and ${which === 'open' ? 'o.outcome is null' : 'o.decided_at > now() - make_interval(days => $2)'}
        order by r.created_at desc, r.id limit 100`,
      which === 'open' ? [areas] : [areas, doneDays],
    )
    return rows.map((row): Card => ({
      id: cardKey.report(row.id),
      group: 'flag',
      areaId: row.area,
      at: row.decided ?? row.at,
      opened: which === 'done',
      done:
        row.outcome && row.decided ? { outcome: reportWords[row.outcome], at: row.decided } : null,
      source: 'ask',
      feedbackId: row.id,
      verdict: 'wrong',
      note: row.what,
      by: row.by,
      question: row.question,
      correction: row.correction,
      link: row.link,
      items: row.title ? [{ id: row.item, title: row.title }] : [],
    }))
  }

  async function checks(bundle: ServingBundle | null, areas: readonly string[]): Promise<Card[]> {
    if (!bundle) return []
    const today = clock.today()
    const due = bundle.items.filter(
      (item) =>
        areas.includes(item.areaId) &&
        (item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)),
    )
    if (!due.length) return []
    const reviews = await tx.query<{ id: string; on: string | null; by: string | null }>(
      `select i.id, r.accepted_on::text as on, (select display_name as name from people where id=r.accepted_by) as by
         from unnest($1::text[]) as i(id)
         left join lateral (select s.version_id from item_version_service s
                             where s.item_id=i.id and upper_inf(s.editions) limit 1) s on true
         left join lateral cl_version_review(s.version_id) r on true`,
      [due.map((item) => item.id)],
    )
    const lastChecked = new Map(reviews.map((r) => [r.id, { on: r.on, by: r.by }]))
    return due.map((item) => ({
      id: cardKey.check(item.id),
      group: 'check',
      areaId: item.areaId,
      at: item.checkFlag === null && item.reviewDate ? item.reviewDate : today,
      opened: false,
      done: null,
      itemId: item.id,
      title: item.title,
      reason: item.checkFlag === null ? 'date' : 'source',
      lastChecked: lastChecked.get(item.id) ?? { on: null, by: null },
    }))
  }

  /** What was decided in the last two weeks: the person's own decisions, and closed cards. */
  async function done(areas: readonly string[]): Promise<Card[]> {
    const decided = await tx.query<{
      id: string
      proposal: string
      outcome: string
      action: string
      at: string
      policy: boolean
    }>(
      `select d.id::text, d.proposal_id::text as proposal, d.outcome::text, p.action::text, d.decided_at::text as at,
              d.auto_policy_id is not null as policy
         from decisions d join proposals p on p.id=d.proposal_id
        where d.decided_by=cl_person() and p.subject='item'
          and d.decided_at > now() - make_interval(days => $1)
          and not exists (select 1 from decision_undos u where u.decision_id=d.id)
        order by d.decided_at desc limit 100`,
      [doneDays],
    )
    const cards: Card[] = []
    for (const row of decided) {
      const p = await loadProposal(tx, row.proposal).catch(() => null)
      if (!p) continue
      const doneAs = {
        outcome:
          outcomeWords[
            row.action === 'recheck'
              ? 'recheck'
              : row.action === 'retire' && row.outcome === 'reject'
                ? 'close'
                : row.policy
                  ? 'policy'
                  : row.outcome
          ] ?? 'Decided',
        at: row.at,
      }
      if (row.action === 'recheck' && p.itemId) {
        cards.push({
          id: cardKey.check(p.itemId),
          group: 'check',
          areaId: p.areaId!,
          at: row.at,
          opened: true,
          done: doneAs,
          itemId: p.itemId,
          title: p.title,
          reason: 'date',
          lastChecked: { on: row.at.slice(0, 10), by: null },
        })
        continue
      }
      cards.push({
        id: cardKey.proposal(p.id),
        group: 'suggestion',
        areaId: p.areaId!,
        at: row.at,
        opened: true,
        done: doneAs,
        proposalId: p.id,
        number: p.number,
        title: p.title,
        action: p.action,
        itemId: p.itemId,
        from: p.proposerId === null ? null : { personId: p.proposerId, name: null },
        writtenBy: p.provenance?.by ?? null,
        agent: p.agentName,
        synced: (await syncedOf(tx, [p.id])).get(p.id) ?? null,
        read: false,
        care: { claims: 0, clash: false },
      })
    }
    const closed = await tx.query<{
      card: string
      area: string
      at: string
      verdict: string
      note: string | null
      items: { id: string; title: string }[]
    }>(
      `select c.card, c.area_id as area, c.decided_at::text as at, f.verdict::text as verdict, f.note,
              ${reportedItems('f')} as items
         from card_states c join feedback f on 'feedback:'||f.id::text=c.card
        where c.area_id=any($1::text[]) and c.decided_at > now() - make_interval(days => $2)
        order by c.decided_at desc limit 100`,
      [areas, doneDays],
    )
    for (const row of closed)
      cards.push({
        id: row.card,
        group: 'flag',
        areaId: row.area,
        at: row.at,
        opened: true,
        done: { outcome: outcomeWords.not_a_problem!, at: row.at },
        source: 'agent',
        feedbackId: row.card.slice('feedback:'.length),
        verdict: row.verdict === 'wrong' ? 'wrong' : 'unclear',
        note: row.note,
        by: null,
        question: null,
        correction: null,
        link: null,
        items: row.items,
      })
    cards.push(...(await reports(areas, 'done')))
    const notWritten = await tx.query<{
      id: string
      ref: string
      at: string
      area: string | null
      areas: string[]
    }>(
      `select g.id::text, g.ref, g.status_since::text as at, t.area_id as area,
              cl_topic_domains(t.area_id, t.metric_keys) as areas
         from gaps g join topics t on t.id=g.topic_id
        where g.status='wont_fix' and g.status_since > now() - make_interval(days => $1)
          and cl_manages_topic(t.area_id, t.metric_keys)
        order by g.status_since desc limit 100`,
      [doneDays],
    )
    for (const row of notWritten)
      cards.push({
        id: cardKey.gap(row.id),
        group: 'gap',
        areaId: row.area ?? row.areas[0] ?? '',
        at: row.at,
        opened: true,
        done: { outcome: outcomeWords.not_written!, at: row.at },
        gapId: row.id,
        ref: row.ref,
        title: row.ref,
        scope: { metrics: [], values: [], dimensions: [], month: null },
        times: null,
        draft: null,
      })
    return cards
  }

  /** One card for each thread with comments that mention the person, unread. */
  async function mentions(): Promise<Card[]> {
    return (await deps.comments.mentionCards()).map((m) => ({
      id: cardKey.mention(m.subject),
      group: 'mention' as const,
      areaId: m.areaId,
      at: m.at,
      opened: false,
      done: null,
      subject: m.subject,
      title: m.title,
      commentId: m.commentId,
      from: m.from,
      excerpt: m.excerpt,
    }))
  }

  /** One card for each domain whose saved questions need a look now, the newest look first. */
  async function looks(areas: readonly string[]): Promise<Card[]> {
    const rows = await tx.query<{
      area: string
      at: string
      questions: { id: string; question: string }[]
    }>(
      `select l.area_id as area, max(l.since)::text as at,
              json_agg(json_build_object('id', q.id::text, 'question', q.question)
                       order by l.since desc, q.created_at desc, q.id) as questions
         from cl_saved_looks() l join saved_questions q on q.id = l.question_id
        where l.area_id = any($1::text[])
        group by l.area_id order by l.area_id`,
      [areas],
    )
    return rows.map((row) => ({
      id: cardKey.look(row.area),
      group: 'look',
      areaId: row.area,
      at: row.at,
      opened: false,
      done: null,
      questions: row.questions,
    }))
  }

  /** The rules turned off for everyone, and those the person muted for a domain. */
  async function alertState(): Promise<AlertState> {
    const off = await tx.query<{ rule: AlertRuleId }>(
      'select rule from alert_rules where not enabled',
    )
    const muted = await tx.query<{ rule: AlertRuleId; areaId: string }>(
      'select rule, area_id as "areaId" from alert_mutes where person_id = cl_person()',
    )
    return { off: off.map((r) => r.rule), muted }
  }

  /**
   * An Alert card for each raise of a rule with a card of its own (Conflict, More questions not
   * found, Calls fail, Model spend, A connected tool did not sync) that reached the person: the
   * relay delivered it to their Inbox items, less those who muted it. It stays for a week after the
   * raise, or until they archive its Inbox item. A connected tool that did not sync and has read
   * well since needs nothing more: its card goes, as on a first start, when the alert job looked
   * at the old reads a moment before the first sync.
   */
  async function alertCards(): Promise<Card[]> {
    const rows = await tx.query<{
      id: string
      at: string
      area: string | null
      rule: AlertCardRule
      title: string
      subject: RaiseSubject
    }>(
      `select r.id::text, r.raised_at::text as at, r.area_ids[1] as area, r.rule, r.title, r.subject
         from inbox_items i join alert_raises r on r.event_seq = i.event_seq
        where i.person_id = cl_person() and i.kind = 'alert.raised' and i.archived_at is null
          and r.rule = any($1::text[]) and r.raised_at > now() - make_interval(days => $2)
          and not (r.rule = 'sync' and exists (
            select 1 from connector_snapshots s
             where s.connector_id = r.subject->>'connector' and s.status in ('ok', 'partial')
               and s.fetched_at > r.raised_at))
          and not (
            exists (select 1 from unnest(r.area_ids) a where cl_is_owner_now(a))
            and not exists (
              select 1 from unnest(r.area_ids) a
               where cl_is_owner_now(a)
                 and not exists (select 1 from alert_mutes m
                                  where m.person_id = cl_person() and m.rule = r.rule and m.area_id = a)))
        order by r.raised_at desc, r.id limit 100`,
      [alertCardRules, alertCardDays],
    )
    return rows.map((row) => ({
      id: cardKey.alert(row.id),
      group: 'alert',
      areaId: row.area ?? '',
      at: row.at,
      opened: false,
      done: null,
      raiseId: row.id,
      rule: row.rule,
      title: row.title,
      subject: row.subject,
    }))
  }

  async function waiting(): Promise<Feed['waiting']> {
    return tx.query<Feed['waiting'][number]>(
      `select p.id::text as "proposalId", coalesce(v.title,p.draft->>'title','Untitled') as title,
              p.area_id as "areaId", p.submitted_at::text as "sentAt",
              coalesce((select array_agg(x.display_name order by x.display_name) from area_assignments a join people x on x.id=a.person_id
                         where a.area_id=p.area_id and a.role='owner' and a.valid_at @> now()
                           and x.deactivated_at is null and x.erased_at is null and x.id<>cl_person()),'{}') as "waitingFor"
         from proposals p left join item_versions v on v.id=p.item_version_id
        where p.proposer_id=cl_person() and p.state in ('submitted','in_review') and p.discarded_at is null
        order by p.submitted_at desc nulls last limit 100`,
    )
  }

  /** This week's questions from agents, as counts (FR-614), and what most that found nothing were about. */
  async function week(bundle: ServingBundle | null, min: number): Promise<Feed['week']> {
    const topics = await tx.query<{
      calls: number
      nothing: number
      area: string | null
      metrics: string[]
      values: string[]
      dimensions: string[]
      month: string | null
    }>(
      `select w.calls, w.no_item_calls as nothing, t.area_id as area, t.metric_keys as metrics,
              t.value_keys as values, t.dimension_keys as dimensions, t.month::text as month
         from v_topic_weeks w join topics t on t.id=w.topic_id
        where w.week=date_trunc('week', $1::date)::date`,
      [clock.today()],
    )
    const asked = topics.reduce((n, t) => n + t.calls, 0)
    const nothing = topics.reduce((n, t) => n + t.nothing, 0)
    // Found and nothing add up to asked: when one is hidden, the other would give it away.
    const found = visibleCount(asked - nothing, min)
    const none = visibleCount(nothing, min)
    const both = found !== null && none !== null
    const top = [...topics].sort((a, b) => b.nothing - a.nothing)[0]
    return {
      asked: visibleCount(asked, min),
      found: both ? found : null,
      nothing: both ? none : null,
      mostAbout:
        top && bundle && top.month && top.nothing >= min
          ? topicWords(
              bundle,
              topicScope({
                metrics: top.metrics,
                values: top.values,
                dimensions: top.dimensions,
                month: top.month,
              }),
            )
          : null,
    }
  }

  return {
    async feed(tab: 'needs' | 'all' = 'needs'): Promise<Feed> {
      const areas = await domains()
      const bundle = await liveBundle()
      const min = await minimum()
      let cards = [
        ...(await gaps(bundle, min)),
        ...(await flags(areas)),
        ...(await reports(areas, 'open')),
        ...(await mentions()),
        ...(await looks(areas)),
        ...(await checks(bundle, areas)),
        ...(await suggestions(areas)),
        ...(await alertCards()),
      ]
      const rules = await alertState()
      cards = cards.filter((c) => cardReaches(c, rules))
      // A suggestion's card is opened by its read receipt, and a mention's by reading the thread.
      const ownRead = (c: Card) => c.group === 'suggestion' || c.group === 'mention'
      const seen = await opened(cards.filter((c) => !ownRead(c)).map((c) => c.id))
      cards = cards.map((c) => (ownRead(c) ? c : { ...c, opened: seen.has(c.id) }))
      const waits = tab === 'all' ? await waiting() : []
      if (tab === 'all') {
        const open = new Set(cards.map((c) => c.id))
        cards.push(...(await done(areas)).filter((c) => !open.has(c.id)))
      }
      const sorted = byNeed(cards)
      return {
        week: await week(bundle, min),
        groups: groupCounts(sorted, waits.length),
        cards: sorted,
        waiting: waits,
      }
    },

    async markRead(cards: readonly string[]): Promise<{ cards: string[] }> {
      const marked: string[] = []
      for (const card of new Set(cards)) {
        const key = parseCardKey(card)
        if (!key) continue
        if (key.kind === 'mention') {
          // Opening a mention's card is reading the comments that mention the person there.
          const read = await deps.comments
            .markMentionsRead({ subject: key.id })
            .then(() => true)
            .catch(() => false)
          if (!read) continue
        } else if (key.kind === 'proposal') {
          const p = await loadProposal(tx, key.id).catch(() => null)
          if (!p) continue
          await tx.query(
            `insert into review_reads (proposal_id,person_id,item_version_id) values ($1,cl_person(),$2)
             on conflict (proposal_id,person_id) do nothing`,
            [p.id, p.itemVersionId],
          )
        } else
          await tx.query(
            `insert into card_reads (person_id,card) values (cl_person(),$1)
             on conflict (person_id,card) do update set read_at=now()`,
            [card],
          )
        marked.push(card)
      }
      return { cards: marked }
    },

    /** A card's one decision (FR-616, FR-618, CON-211, FR-218), with a token that undoes it (FR-227). */
    async decide(input: { card: string; action: CardAction; reason?: string | undefined }) {
      const key = parseCardKey(input.card)
      const kindsOf = { gap: ['gap'], flag: ['feedback', 'report'], check: ['check'] } as const
      if (!key || !(kindsOf[actionGroup[input.action]] as readonly string[]).includes(key.kind))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: "This card doesn't offer that decision.",
        })
      if (input.action === 'not_written') {
        await deps.gaps.setStatus(
          key.id,
          'wont_fix',
          input.reason ?? 'Not something we write down.',
        )
        return { edition: null, undo: `gap:${key.id}` }
      }
      if (input.action === 'not_a_problem') {
        const [row] = await tx.query<{ area: string | null }>(
          key.kind === 'report'
            ? `select area_id as area from reports where id::text=$1`
            : `select area_id as area from feedback where id=$1 and verdict in ('wrong','unclear')`,
          [key.id],
        )
        if (!row?.area) throw new ORPCError('NOT_FOUND')
        await tx
          .query(
            `insert into card_states (card,area_id,state,decided_by) values ($1,$2,'closed',cl_person())`,
            [input.card, row.area],
          )
          .catch((error: unknown) => {
            const code = (error as { code?: string }).code
            if (code === '23505')
              throw new ORPCError('CONFLICT', { message: 'Someone closed this report already.' })
            if (code === '42501')
              throw new ORPCError('FORBIDDEN', {
                message: 'Only an owner of its domain, or an admin, closes a report.',
              })
            throw error
          })
        return { edition: null, undo: `card:${input.card}` }
      }
      const reason =
        input.reason ??
        (input.action === 'still_true' ? 'Checked: still true.' : 'Archived from the Inbox.')
      if (input.action === 'still_true') {
        // Heed v1's check (FR-139): an owner of its domain or an admin, as Mark as checked.
        const result = await deps.review.recheck(key.id, reason, { v1: true })
        const [decision] = await tx.query<{ id: string }>(
          `select id::text from decisions where proposal_id=$1 and decided_by=cl_person() and outcome='accept'
            order by decided_at desc limit 1`,
          [result.proposal.id],
        )
        if (!decision) throw new Error('The check was not recorded')
        return { edition: result.edition?.label ?? null, undo: `decision:${decision.id}` }
      }
      const edition = await deps.review.retire(key.id, reason)
      const [decision] = await tx.query<{ id: string }>(
        `select d.id::text from decisions d join item_versions v on v.id=d.item_version_id
          where v.item_id=$1 and d.decided_by=cl_person() and d.outcome='retire'
          order by d.decided_at desc limit 1`,
        [key.id],
      )
      if (!decision) throw new Error('The archive was not recorded')
      return { edition: edition.label, undo: `decision:${decision.id}` }
    },

    /** Opens a card again that its maker closed moments ago (FR-227). */
    async undoCard(token: string): Promise<{ edition: string | null }> {
      const [kind, ...rest] = token.split(':')
      const ref = rest.join(':')
      if (kind === 'card') {
        const removed = await tx.query(
          'delete from card_states where card=$1 and decided_by=cl_person() returning 1',
          [ref],
        )
        if (!removed.length)
          throw new ORPCError('CONFLICT', {
            message: 'It is too late to undo this, or someone else closed it.',
          })
        return { edition: null }
      }
      if (kind === 'gap') {
        // Opening a gap again is a decision every owner of its domain may make at any time, so its
        // undo needs no window: only that it is still closed as not written down.
        const [gap] = await tx.query<{ status: string }>(
          'select status::text from gaps where id=$1',
          [ref],
        )
        if (gap?.status !== 'wont_fix')
          throw new ORPCError('CONFLICT', { message: 'Someone already opened this again.' })
        await deps.gaps.setStatus(ref, 'open', 'Undone.')
        return { edition: null }
      }
      throw new ORPCError('NOT_FOUND')
    },

    /** A new workspace's setup checklist (FR-816), read from what exists. */
    async setup(): Promise<{ steps: { id: SetupStep; done: boolean }[]; done: boolean }> {
      const [row] = await tx.query<Record<SetupStep, boolean>>(
        `select coalesce(length(btrim((select value #>> '{}' from settings_current where key='business.about'))),0) > 0 as about,
                exists(select 1 from live_edition l join item_version_service s on s.editions @> l.seq) as fact,
                exists(select 1 from setup_marks where step='ask') as ask,
                (exists(select 1 from mcp_requests where client_label<>'eval')
                 or exists(select 1 from auth.oauth_grants)) as agent,
                exists(select 1 from connectors c join connector_snapshots n on n.connector_id=c.id
                         where n.status='ok' and c.removed_at is null) as definitions`,
      )
      const steps = setupSteps.map((id) => ({ id, done: Boolean(row?.[id]) }))
      return { steps, done: steps.every((s) => s.done) }
    },

    /** Ask was used: the checklist's step that leaves no other record (no words, nobody). */
    async askedOnce(): Promise<void> {
      await tx.query(`insert into setup_marks (step) values ('ask') on conflict (step) do nothing`)
    },
  }
}

export type InboxFeedService = ReturnType<typeof createInboxFeedService>
