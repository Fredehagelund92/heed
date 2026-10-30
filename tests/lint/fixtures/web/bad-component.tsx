// Deliberately wrong: tests/lint/app-guard-rails.test.ts lints this as a file of the new app.
import { CheckIcon } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'

export function Bad({ open }: { open: boolean }) {
  return (
    <div className="z-50 bg-red-500 p-4 text-[13px] transition-all duration-300 ease-in">
      <Dialog.Root open={open} />
      <span className="scale-0 animate-[wiggle_1s] motion-reduce:transition-none" />
      <span className="animate-in fade-in-0 motion-reduce:animate-none" />
      <span className="not-a-real-class font-light" />
      <p style={{ padding: 13 }}>Heed keeps a fact checked.</p>
      <CheckIcon />
    </div>
  )
}
