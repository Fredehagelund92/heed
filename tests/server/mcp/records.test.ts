import { expect, it } from 'vitest'
import { createAnonymousQueue, type AnonymousRecord } from '../../../src/server/mcp/records.ts'

const record = (id: string): AnonymousRecord => ({ kind: 'request', value: { id } as never })

/** A store whose writes finish only when the test says so, and that notes what is durable. */
function slowStore() {
  const written: string[] = []
  const gates: (() => void)[] = []
  return {
    written,
    gates,
    store: {
      write(records: readonly AnonymousRecord[]) {
        return new Promise<void>((resolve) => {
          gates.push(() => {
            for (const r of records) written.push((r.value as { id: string }).id)
            resolve()
          })
        })
      },
      reportGap: () => Promise.resolve(''),
      feedback: () => Promise.resolve(),
    },
  }
}
const turns = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

it('flush resolves only once everything queued before it is written, even while a batch is in flight', async () => {
  const s = slowStore()
  const queue = createAnonymousQueue(s.store, () => undefined)
  queue.enqueue(record('first'))
  const first = queue.flush()
  await turns()
  // The first batch is being written; a record queued now belongs to a second batch.
  queue.enqueue(record('second'))
  let settled = false
  const second = queue.flush().then(() => (settled = true))
  await turns()
  s.gates[0]!()
  await turns()
  // The second record is still in flight: a flush that has returned would have lost it.
  expect(settled).toBe(false)
  s.gates[1]!()
  await Promise.all([first, second])
  expect(s.written).toEqual(['first', 'second'])
})
