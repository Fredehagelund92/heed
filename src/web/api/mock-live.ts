/**
 * The mock's outbox, inboxes and live stream, with the rules of the service's notifications
 * module (src/server/modules/notifications and migrations 0021 and 0023): every change the mock
 * workflow makes posts one event, in order; the people it concerns get an inbox item; and each
 * person's stream carries the events they may see, numbered as the relay numbers them, so
 * `Last-Event-ID` replays exactly the events after it. The conformance suite
 * (tests/conformance/context-api-live.ts) runs the same steps on this and on the service.
 *
 * The mock keeps every event, so a known `Last-Event-ID` always replays; only an id past the
 * newest event, or one that is not a number, answers `stream.reset`.
 */
import type { InboxItem, StreamEvent } from '../../contract/notifications.ts'
import type { Person } from '../../domain/item.ts'
import type { InboxChange, InboxIds, InboxListParams, InboxPage } from './client.ts'

type Subject = { type: string; id: string }

/** What a change posts. Recipients and visibility are the workflow's rules, decided at posting. */
export type MockEventDraft = {
  topic: string
  areaId: string | null
  subject: Subject
  /** Ids and states only, as on the service. */
  payload: Record<string, unknown>
  /** Who acted; null for system work. Never told about their own action. */
  actorId: string | null
  /** Who gets an inbox item. */
  recipients?: readonly string[]
  /** What a reviewer wrote with the decision: on the inbox items only, never on a stream. */
  note?: string
  /** Who may see the event on their stream, decided when the stream reads it. */
  visibleTo: (personId: string) => boolean
}

type StoredEvent = Omit<MockEventDraft, 'recipients'> & { id: number; at: string }

type StoredItem = {
  id: string
  personId: string
  eventId: number
  readAt: string | null
  archivedAt: string | null
}

export type MockOutboxOptions = {
  now: () => string
  people: readonly Person[]
  /** The subject's title, when the reader may still see it (null otherwise, or for an edition). */
  titleOf: (subject: Subject, personId: string) => string | null
}

export function createMockOutbox({ now, people, titleOf }: MockOutboxOptions) {
  const events: StoredEvent[] = []
  const items: StoredItem[] = []
  const listeners = new Set<() => void>()
  /**
   * Inbox ids are counted on their own, so posting events leaves the workflow's ids (which
   * stories and tests name) unchanged. They grow with time, as the service's do.
   */
  const itemId = () =>
    `00000000-0000-4000-9000-${(items.length + 1).toString(16).padStart(12, '0')}`

  function post({ recipients = [], ...draft }: MockEventDraft) {
    const event: StoredEvent = { ...draft, id: events.length + 1, at: now() }
    events.push(event)
    for (const personId of new Set(recipients)) {
      if (personId === draft.actorId || !people.some((person) => person.id === personId)) continue
      items.push({ id: itemId(), personId, eventId: event.id, readAt: null, archivedAt: null })
    }
    for (const listener of [...listeners]) listener()
  }

  const actorOf = (id: string | null) => {
    const person = id ? people.find((candidate) => candidate.id === id) : undefined
    return person ? { id: person.id, name: person.name } : null
  }

  const marker = (topic: string, id: number): StreamEvent => ({
    id,
    topic,
    at: now(),
    areaId: null,
    subject: null,
    payload: {},
    inbox: false,
  })

  /** Resolves on the next event, or when the stream is closed. */
  function next(signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const done = () => {
        listeners.delete(done)
        signal.removeEventListener('abort', done)
        resolve()
      }
      listeners.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  /** One person's inbox: they read, mark and archive only their own items. */
  function inboxOf(personId: string) {
    const own = () => items.filter((item) => item.personId === personId)
    const unread = () => own().filter((item) => !item.readAt && !item.archivedAt).length
    const toInboxItem = (item: StoredItem): InboxItem => {
      const event = events[item.eventId - 1]!
      const state = event.payload.state
      return {
        id: item.id,
        kind: event.topic,
        at: event.at,
        areaId: event.areaId,
        subject: { ...event.subject },
        state: typeof state === 'string' ? state : null,
        title: titleOf(event.subject, personId),
        actor: actorOf(event.actorId),
        note: event.note ?? null,
        readAt: item.readAt,
        archivedAt: item.archivedAt,
      }
    }
    /** Each change that touched something tells the person's other tabs the new unread count. */
    function changed(touched: readonly StoredItem[]): InboxChange {
      const count = unread()
      if (touched.length)
        post({
          topic: 'inbox.changed',
          areaId: null,
          subject: { type: 'inbox', id: personId },
          payload: { unread: count },
          actorId: personId,
          visibleTo: (reader) => reader === personId,
        })
      return { changed: touched.length, unread: count }
    }
    return {
      list({ filter = 'all', limit = 50, before }: InboxListParams = {}): InboxPage {
        const shown = own()
          .filter(
            (item) =>
              (before === undefined || item.id < before) &&
              (filter === 'unread'
                ? !item.readAt && !item.archivedAt
                : filter === 'archived'
                  ? item.archivedAt !== null
                  : item.archivedAt === null),
          )
          .sort((a, b) => (a.id < b.id ? 1 : -1))
        const page = shown.slice(0, limit)
        return {
          items: page.map(toInboxItem),
          unread: unread(),
          nextBefore: shown.length > limit ? page.at(-1)!.id : null,
        }
      },
      markRead({ ids }: InboxIds): InboxChange {
        const at = now()
        const touched = own().filter((item) => ids.includes(item.id) && !item.readAt)
        for (const item of touched) item.readAt = at
        return changed(touched)
      },
      markAllRead(): InboxChange {
        const at = now()
        const touched = own().filter((item) => !item.readAt && !item.archivedAt)
        for (const item of touched) item.readAt = at
        return changed(touched)
      },
      archive({ ids }: InboxIds): InboxChange {
        const at = now()
        const touched = own().filter((item) => ids.includes(item.id) && !item.archivedAt)
        for (const item of touched) {
          item.archivedAt = at
          item.readAt ??= at
        }
        return changed(touched)
      },
    }
  }

  /**
   * One person's live stream, as `streamEvents` in the service reads it: `stream.ready` without
   * `Last-Event-ID`, a replay after a known one, `stream.reset` otherwise; then every new event
   * the person may see, until `signal` aborts.
   */
  async function* stream(
    personId: string,
    { lastEventId, signal }: { lastEventId?: string; signal: AbortSignal },
  ): AsyncGenerator<StreamEvent> {
    const requested = /^\d{1,15}$/.test(lastEventId ?? '') ? Number(lastEventId) : undefined
    const head = events.length
    let cursor: number
    if (requested === undefined || requested > head) {
      yield marker(lastEventId === undefined ? 'stream.ready' : 'stream.reset', head)
      cursor = head
    } else cursor = requested
    while (!signal.aborted) {
      while (cursor < events.length && !signal.aborted) {
        const event = events[cursor++]!
        if (!event.visibleTo(personId)) continue
        yield {
          id: event.id,
          topic: event.topic,
          at: event.at,
          areaId: event.areaId,
          subject: { ...event.subject },
          payload: structuredClone(event.payload),
          inbox: items.some((item) => item.eventId === event.id && item.personId === personId),
        }
      }
      if (!signal.aborted) await next(signal)
    }
  }

  return { post, inboxOf, stream }
}

export type MockOutbox = ReturnType<typeof createMockOutbox>
