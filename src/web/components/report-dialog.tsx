import * as React from 'react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { reportHref, supportByMail, supportTarget } from '@/lib/help-content'
import { onOpen } from '@/lib/events'
import { cn } from '@/lib/utils'

/**
 * Report a problem: one box. Send opens a mail to support in the person's own mail app, or an
 * issue on GitHub when the install names no support address, with the page it was sent from, so
 * nothing goes through the service. The words of questions never go with it: the page's address
 * leaves out its query.
 */
export function ReportDialog() {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  React.useEffect(() => onOpen('report', () => setOpen(true)), [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            {supportByMail
              ? 'Say what happened and what you expected. It opens in your mail app with the page you are on, nothing else.'
              : 'Say what happened and what you expected. It opens as an issue on GitHub with the page you are on, nothing else. Anyone can read an issue, so leave out anything private.'}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="What happened"
          placeholder="What happened?"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {text.trim() ? (
            <a
              href={reportHref(text, window.location)}
              {...supportTarget}
              className={cn(buttonVariants())}
              onClick={() => {
                setOpen(false)
                setText('')
                toast(
                  supportByMail ? 'Opened in your mail app' : 'Opened on GitHub',
                  supportByMail
                    ? { description: 'Send it from there. Support will reply by email.' }
                    : { description: 'Finish it there. Replies come on the issue.' },
                )
              }}
            >
              Send
            </a>
          ) : (
            <Button disabled>Send</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
