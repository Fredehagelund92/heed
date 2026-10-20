// A deliberately wrong component. tests/lint/guard-rails.test.ts lints this file and expects
// every line below to be reported. It is ignored by `npm run lint`.
import { CheckIcon } from 'lucide-react'
import { Dialog } from '@radix-ui/react-dialog'

export function BadComponent() {
  return (
    <div className="p-7 w-[13px] bg-red-500 text-[#fff] mt-2.5 gap-4! text-sm z-50 md:flex px-gutter" style={{ padding: 13 }}>
      <CheckIcon />
      <Dialog />
    </div>
  )
}
