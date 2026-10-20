import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDownIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import './answer-motion.css'

/*
  How the conversation scrolls (contract 10): a question just sent comes to the top of what
  scrolls it, below the panel's tabs or the page's header, and its answer grows under it without
  the view chasing the words. The newest answer keeps room under the question, the height that
  is left of the view, so the question always reaches the top and nothing moves while the answer
  grows; an older answer gives the room up when the next question is sent. When the end of the
  newest answer is more than 100 pixels below the fold (the panel's bottom edge, or the page's
  composer bar), a Latest pill at that edge goes to it.

  The panel scrolls its body, the page the window; `frameOf` is the one place that knows which.
  Each streamed sentence costs only reads here: the room is written when a question is sent, when
  its answer's element arrives, and when the view changes size.
*/

/** The gap between a question brought to the top and what covers the top of the view. */
const TOP_GAP = 16
/** How far below the fold the latest words are before the Latest pill shows. */
const BELOW_FOLD = 100

/** What scrolls a conversation, and what covers its edges. */
type Frame = {
  /** Where to scroll for a node to sit at the top of the view, below the tabs or the header. */
  topOf: (node: HTMLElement) => number
  /** The furthest it scrolls. */
  end: () => number
  /** Where the view ends: the panel's bottom edge, or the top of the page's composer bar. */
  fold: () => number
  /** How far the fold is above the bottom of what scrolls. */
  inset: () => number
  scrollTo: (top: number) => void
  /** Elements whose size changes the view, and what to listen to for a scroll. */
  resizes: Element[]
  scrolls: HTMLElement | Window
}

const smooth = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

/**
 * Where a node's top is in the viewport, as laid out: a question just sent is still rising into
 * place, and its transform must not move where it is scrolled to.
 */
function layoutTop(node: HTMLElement): number {
  const [, rise] = getComputedStyle(node).translate.split(' ')
  return node.getBoundingClientRect().top - (rise ? Number.parseFloat(rise) : 0)
}

function frameOf(node: HTMLElement): Frame {
  const panel = node.closest<HTMLElement>('[data-slot=dock-panel] .overflow-y-auto')
  if (panel)
    return {
      topOf: (target) => {
        const tabs = panel.querySelector('[role=tablist]')?.getBoundingClientRect().height ?? 0
        const top = layoutTop(target) - panel.getBoundingClientRect().top
        return top + panel.scrollTop - tabs - TOP_GAP
      },
      end: () => panel.scrollHeight - panel.clientHeight,
      fold: () => panel.getBoundingClientRect().bottom,
      inset: () => 0,
      scrollTo: (top) => panel.scrollTo({ top, behavior: smooth() }),
      resizes: [panel],
      scrolls: panel,
    }
  const page = document.scrollingElement ?? document.documentElement
  const bar = () =>
    node.closest('[data-slot=page]')?.querySelector<HTMLElement>('[data-slot=page-sticky-bar]')
  return {
    topOf: (target) => {
      const header = document.querySelector('[data-layout=header]')?.getBoundingClientRect()
      return layoutTop(target) + window.scrollY - (header?.bottom ?? 0) - TOP_GAP
    },
    end: () => page.scrollHeight - window.innerHeight,
    fold: () => bar()?.getBoundingClientRect().top ?? window.innerHeight,
    inset: () => bar()?.offsetHeight ?? 0,
    scrollTo: (top) => window.scrollTo({ top, behavior: smooth() }),
    resizes: [page, ...(bar() ? [bar()!] : [])],
    scrolls: window,
  }
}

/** The newest answer, and the room it keeps under its question. */
type Room = { question: Element | null; answer: HTMLElement | null; height: number }

/**
 * Gives the newest answer the room it needs, so its question can scroll to the top, and no
 * further: the room is what the scroll falls short by. Layout that fills the view (the page's
 * columns) takes the first part of it, so it is measured again until it holds. The room is the
 * answer's own minimum height, set on it alone: a value the whole conversation inherited would
 * restyle every answer each time it changed. An older answer gives its room up.
 */
function keepRoom(room: Room, question: HTMLElement, frame: Frame) {
  const answer =
    question.nextElementSibling instanceof HTMLElement ? question.nextElementSibling : null
  if (room.answer && room.answer !== answer) room.answer.style.removeProperty('min-height')
  if (room.question !== question) room.height = 0
  room.question = question
  room.answer = answer
  if (!answer) return
  if (room.height) answer.style.minHeight = `${room.height}px`
  for (let tries = 0; tries < 3; tries += 1) {
    const short = frame.topOf(question) - frame.end()
    const next = Math.round(
      Math.max(
        0,
        short > 0
          ? Math.max(room.height, answer.getBoundingClientRect().height) + short
          : room.height + short,
      ),
    )
    if (Math.abs(next - room.height) < 1) return
    room.height = next
    if (next) answer.style.minHeight = `${next}px`
    else answer.style.removeProperty('min-height')
  }
}

/**
 * The conversation's scrolling: room under the newest question, the question just sent brought to
 * the top, and whether the newest words are below the fold. `sent` is the question waiting for its
 * answer; `answerId` names what follows the newest question (it changes when a pending answer
 * becomes the message); `shown` changes whenever what the log shows may have moved.
 */
export function useConversationScroll({
  root,
  log,
  question,
  questionId,
  answerId,
  sent,
  shown,
  status,
}: {
  root: RefObject<HTMLElement | null>
  log: RefObject<HTMLElement | null>
  question: RefObject<HTMLElement | null>
  /** The newest question, which keeps room under it. */
  questionId: string | null
  answerId: string | null
  sent: string | null
  /** What the log shows: when it changes, the words may have moved. */
  shown: unknown
  /** Whether an answer is on its way: when it is done, its closing rows have come in. */
  status: string
}) {
  const [below, setBelow] = useState(false)
  const frame = useRef<Frame | null>(null)
  const room = useRef<Room>({ question: null, answer: null, height: 0 })
  const measure = useRef<(() => void) | null>(null)

  // The room, and the question just sent to the top once the room lets it get there.
  useLayoutEffect(() => {
    const node = log.current
    const newest = question.current
    if (!node || !newest) return
    frame.current = frameOf(node)
    keepRoom(room.current, newest, frame.current)
    if (sent) frame.current.scrollTo(Math.max(0, frame.current.topOf(newest)))
  }, [log, question, questionId, answerId, sent])

  // Whether the newest words are below the fold, once a frame, and where the fold is. The view or
  // the question changes size: the room follows. A scroll moves the fold, and a part of an answer
  // opened or closed moves the words.
  useEffect(() => {
    const node = log.current
    const newest = question.current
    if (!node) return
    const area = frameOf(node)
    frame.current = area
    let pending = 0
    const check = () => {
      if (pending) return
      pending = window.requestAnimationFrame(() => {
        pending = 0
        // Only on the pill's own frame, and only when it moved.
        const pill = root.current?.querySelector<HTMLElement>('[data-slot=ask-latest-frame]')
        const fold = `${area.inset()}px`
        if (pill && pill.style.getPropertyValue('--ask-fold') !== fold)
          pill.style.setProperty('--ask-fold', fold)
        const last = node.lastElementChild
        const end = (last?.lastElementChild ?? last)?.getBoundingClientRect().bottom ?? 0
        setBelow(end - area.fold() > BELOW_FOLD)
      })
    }
    const onResize = () => {
      if (newest) keepRoom(room.current, newest, area)
      check()
    }
    measure.current = check
    check()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    for (const element of [...area.resizes, ...(newest ? [newest] : [])]) observer?.observe(element)
    window.addEventListener('resize', onResize)
    area.scrolls.addEventListener('scroll', check, { passive: true })
    // A disclosure's toggle does not bubble, so it is caught on its way down.
    node.addEventListener('toggle', check, true)
    return () => {
      measure.current = null
      window.cancelAnimationFrame(pending)
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      area.scrolls.removeEventListener('scroll', check)
      node.removeEventListener('toggle', check, true)
    }
  }, [root, log, question, questionId])

  // The words grew, or the answer finished.
  useLayoutEffect(() => measure.current?.(), [shown, status])

  const toLatest = () => {
    const area = frame.current
    if (area) area.scrollTo(area.end())
  }
  return { below, toLatest }
}

/**
 * The Latest pill: at the bottom edge of the view while the newest words are below it, and goes
 * there. It is no live region; the conversation's one status already says when an answer is ready.
 * Used from the keyboard, it hands the focus to the question box, since the pill then goes away.
 */
export function LatestPill({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <div
      data-slot="ask-latest-frame"
      className="pointer-events-none sticky bottom-(--ask-fold) z-sticky h-0"
    >
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <span
          data-slot="ask-latest"
          data-hidden={shown ? undefined : ''}
          inert={!shown}
          className="latest-pill pointer-events-auto"
        >
          <Button
            variant="outline"
            size="sm"
            className="rounded-full shadow-raised dark:bg-popover"
            onClick={(event) => {
              onClick()
              if (event.detail === 0)
                document
                  .querySelector<HTMLElement>('[data-slot=ask-composer] [role=textbox]')
                  ?.focus({ preventScroll: true })
            }}
          >
            <ArrowDownIcon />
            Latest
          </Button>
        </span>
      </div>
    </div>
  )
}
