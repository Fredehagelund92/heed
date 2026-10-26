import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { onOpen } from '@/lib/events'

/** Report a problem: one box. The page it was sent from travels with it; the words of questions never do. */
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
            Say what happened and what you expected. It is sent with the page you are on and your
            name, nothing else.
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
          <Button
            disabled={!text.trim()}
            onClick={() => {
              setOpen(false)
              setText('')
              toast('Sent', { description: 'Support will reply by email.' })
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
