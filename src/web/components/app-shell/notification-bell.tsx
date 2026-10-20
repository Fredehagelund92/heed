import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { inboxUnreadQuery, type InboxUnread } from '@/api/queries'
import { BellIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// The popover and its list load the first time the bell is pointed at, focused or pressed, so
// neither is part of the first load: the bell itself reads only the unread count.
const loadPopover = () => import('./notifications-popover')
const NotificationsPopover = lazy(() =>
  loadPopover().then((module) => ({ default: module.NotificationsPopover })),
)

/**
 * Says a new notification out loud once, politely, when it arrives while the app is open
 * (contract 9.5: counts and arrivals are live). Notifications already there when the bell first
 * read the inbox, and older ones that become the newest unread, are not announced. Inbox ids
 * grow with time, so a newer notification has a larger id. The words load with the first one.
 */
function useArrivalAnnouncement(data: InboxUnread | undefined) {
  const newest = useRef<string | null | undefined>(undefined)
  const [message, setMessage] = useState('')
  const latest = data?.latest ?? null
  useEffect(() => {
    if (data === undefined) return
    if (newest.current === undefined) {
      newest.current = latest?.id ?? null
      return
    }
    if (!latest || (newest.current !== null && latest.id <= newest.current)) return
    newest.current = latest.id
    void import('@/lib/notifications').then(({ notificationSentence, sentenceText }) =>
      setMessage(`New notification: ${sentenceText(notificationSentence(latest))}`),
    )
  }, [data, latest])
  return message
}

/**
 * The header's bell (slice W7): a dot while something is unread, and the notifications list in a
 * popover. Its name carries the count ("Notifications, 3 unread").
 */
export function NotificationBell() {
  const { data } = useQuery(inboxUnreadQuery())
  const [open, setOpen] = useState(false)
  const [wanted, setWanted] = useState(false)
  const bell = useRef<HTMLButtonElement>(null)
  const unread = data?.unread ?? 0
  const announcement = useArrivalAnnouncement(data)
  const label = unread ? `Notifications, ${unread.toLocaleString('en')} unread` : 'Notifications'
  const want = () => {
    setWanted(true)
    void loadPopover()
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={bell}
              variant="ghost"
              size="icon-toolbar"
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={open}
              onPointerEnter={want}
              onFocus={want}
              onClick={() => {
                want()
                setOpen((current) => !current)
              }}
              className="relative max-md:size-control-touch"
            />
          }
        >
          <BellIcon />
          {unread ? (
            <span
              data-slot="unread-dot"
              aria-hidden="true"
              className="absolute top-1 right-1 size-2 rounded-full bg-status-danger-icon ring-2 ring-background max-md:top-2 max-md:right-2"
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {wanted ? (
        <Suspense fallback={null}>
          <NotificationsPopover open={open} onOpenChange={setOpen} bell={bell} />
        </Suspense>
      ) : null}
      {/* A live region after the page's content, where arrivals are read out. */}
      {createPortal(
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          data-slot="notification-announcer"
        >
          {announcement}
        </div>,
        document.body,
      )}
    </>
  )
}
