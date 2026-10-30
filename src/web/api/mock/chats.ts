import type { Thread } from '@/model/ask'
import { examples } from './data/ask'

// The chats under Ask, kept in memory until the page reloads: the seeded ones from the demo world
// and the chats the person starts, renames and deletes. Only the person's own chats in Ask.

type Stored = Omit<Thread, 'preview'>

const question = (id: string) => examples.find((e) => e.id === id)!.question
const seeded = (id: string, day: Thread['day'], time: string): Stored => ({
  id,
  title: question(id),
  question: question(id),
  example: id,
  day,
  time,
  seed: true,
})

const LONG =
  'Before the weekly note goes out: has anything changed in how gross margin is counted for Spain since the price promotions came back?'

export function createChats() {
  let threads: Stored[] = [
    seeded('synonym', 'Today', '09:40'),
    seeded('grounded', 'Today', '09:12'),
    seeded('conflict', 'Today', '08:40'),
    seeded('missing', 'Today', '08:05'),
    seeded('partial', 'Yesterday', '16:30'),
    seeded('correction', 'Yesterday', '14:02'),
    {
      id: 'margin-spain',
      title: LONG,
      question: LONG,
      day: 'Yesterday',
      time: '11:47',
      seed: true,
    },
    seeded('stale', 'Earlier', 'Tue'),
    seeded('failed', 'Earlier', '19 Oct'),
  ]
  return {
    list: () => threads,
    /** A chat the person just started, at the top of Today. */
    add(id: string, q: string) {
      const now = new Date()
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      threads = [
        { id, title: q, question: q, day: 'Today', time },
        ...threads.filter((t) => t.id !== id),
      ]
    },
    rename(id: string, title: string) {
      threads = threads.map((t) => (t.id === id ? { ...t, title } : t))
    },
    /** Deletes a chat and gives back what puts it back where it was. */
    remove(id: string) {
      const index = threads.findIndex((t) => t.id === id)
      const gone = threads[index]
      threads = threads.filter((t) => t.id !== id)
      return () => {
        if (!gone || threads.some((t) => t.id === id)) return
        threads = [...threads.slice(0, index), gone, ...threads.slice(index)]
      }
    },
  }
}
