import { useEffect } from 'react'
import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { connectToasts } from '@/lib/toast'
import { XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'

/**
 * Toasts on Base UI (contract 7.1): a message in a polite status region, at most one at a time,
 * 5 seconds (10 with an action such as Undo, or what the toast asks for), paused on hover and
 * focus. They enter with an 8 pixel rise and fade (contract 10).
 */
const toastManager = ToastPrimitive.createToastManager()

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      className="flex w-full items-center gap-3 rounded-lg border bg-popover py-2 pr-2 pl-4 text-dense text-popover-foreground shadow-raised transition duration-base ease-out data-ending-style:opacity-0 data-ending-style:duration-instant data-starting-style:translate-y-2 data-starting-style:opacity-0"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <ToastPrimitive.Title className="font-bold" />
        <ToastPrimitive.Description className="text-muted-foreground" />
      </div>
      {toast.actionProps ? (
        <ToastPrimitive.Action
          data-slot="toast-action"
          render={<Button variant="outline" size="sm" className="shrink-0" />}
        />
      ) : null}
      {/*
        Base UI hides Close from assistive technology until a stack of toasts is expanded, yet
        keeps it in the tab order. There is one toast at a time here, so it is always exposed.
      */}
      <ToastPrimitive.Close
        aria-hidden={false}
        aria-label="Dismiss"
        className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
      >
        <XIcon />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ))
}

/**
 * The one toast region of the app. The shell mounts it lazily, the first time `showToast`
 * (src/web/lib/toast.ts) is called, and it then takes the queued messages.
 */
export function Toaster() {
  useEffect(
    () =>
      connectToasts(
        (message) => {
          const action = message.action
          const id = toastManager.add({
            ...(message.id ? { id: message.id } : {}),
            title: message.title,
            description: message.description,
            // A toast with an action (Undo) stays longer, so there is time to reach it.
            timeout: message.timeout ?? (action ? 10000 : 5000),
            ...(message.onClose ? { onClose: message.onClose } : {}),
            ...(action
              ? {
                  actionProps: {
                    children: action.label,
                    // An action is done once: it runs, then its toast goes, so Undo is never
                    // offered twice. It runs first, so a held step is taken back before the
                    // toast's closing would send it.
                    onClick: () => {
                      action.onClick()
                      toastManager.close(id)
                    },
                  },
                }
              : {}),
          })
        },
        (id) => toastManager.close(id),
      ),
    [],
  )
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={1}>
      <ToastPrimitive.Portal>
        {/*
          Toasts stack above the assistant launcher in the corner. Beside a docked or overlaid
          panel, they sit left of it, clear of its footer, as the launcher does.
        */}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-above-launcher z-toast flex w-popover max-w-inset flex-col [body:has([data-slot=dock-panel]:not([data-mode=full]):not([data-leaving]))_&]:right-dock [body:has([data-slot=dock-panel]:not([data-mode=full]):not([data-leaving]))_&]:-translate-x-4">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}
