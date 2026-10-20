import type { AppFamily } from '../../domain/app-family.ts'
import type { GapTopic } from '../../domain/gap-reports.ts'
import type { ResolvedScope } from '../../domain/scope.ts'
import type { Resolution } from '../../domain/resolver.ts'

export type DeliveryRecord = {
  id: string
  hour: string
  client: string
  caller: 'agent' | 'eval'
  edition: string
  overlay: string
  digest: string
  topic: Topic | null
  scope: (ResolvedScope & { today: string; max_items: number; max_bytes: number }) | null
  status: Resolution['status']
  delivered: { id: string; v: number; rank: number; label: string }[]
  withheld: Resolution['withheld']
  cut: boolean
  bytes: number
  duration: number
}
/** A read tool's outcome, as its result's `status` says it; null for every other request. */
export const resultStatuses = ['matched', 'need_more_detail', 'no_match'] as const
export type ResultStatus = (typeof resultStatuses)[number]
export type RequestRecord = {
  id: string
  hour: string
  client: string
  /** The kind of AI app, from its self-reported name; the name itself is never kept (FR-410). */
  family: AppFamily
  tool: string
  /** `invalid_input`: a tool call whose arguments do not fit the tool's input schema. */
  status: 'ok' | 'error' | 'invalid_input' | 'rate_limited' | 'forbidden' | 'unauthorized'
  result: ResultStatus | null
  duration: number
  edition: string | null
  bytes: number
}
export type AnonymousRecord =
  { kind: 'delivery'; value: DeliveryRecord } | { kind: 'request'; value: RequestRecord }
/** The topic of a delivery or a report (FR-604). */
export type Topic = GapTopic
export interface AnonymousStore {
  write(records: readonly AnonymousRecord[]): Promise<void>
  reportGap(topic: Topic, note?: string): Promise<string>
  feedback(
    delivery: string,
    verdict: 'helpful' | 'wrong' | 'missing' | 'unclear',
    client: string,
    note?: string,
  ): Promise<void>
}

/** A bounded queue never retains a request, token, question, or caller identity. Failed batches are counted and dropped. */
export function createAnonymousQueue(
  store: AnonymousStore,
  onFailure: (count: number) => void,
  capacity = 1000,
) {
  let pending: AnonymousRecord[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (running) await running
    if (!pending.length) return
    const batch = pending
    pending = []
    running = store.write(batch).catch(() => onFailure(batch.length))
    await running
    running = undefined
    if (pending.length) await flush()
  }
  return {
    enqueue(record: AnonymousRecord) {
      if (pending.length >= capacity) {
        onFailure(1)
        return
      }
      pending.push(record)
      timer ??= setTimeout(() => {
        void flush()
      }, 25)
      timer.unref()
    },
    flush,
  }
}
export type AnonymousQueue = ReturnType<typeof createAnonymousQueue>
