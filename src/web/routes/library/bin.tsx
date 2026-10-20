import { createFileRoute } from '@tanstack/react-router'
import { BinPage } from '@/components/library/bin-page'
import { AudienceGate } from '@/components/page/audience-gate'

export const Route = createFileRoute('/library/bin')({
  component: BinRoute,
})

/**
 * The Bin: items an administrator moved out of the library, and the way to restore them. Only
 * administrators see it in the sidebar; anyone else who opens the address is told whose page it
 * is, and nothing of it is read. The service checks every call again.
 */
function BinRoute() {
  return (
    <AudienceGate
      audience="administrators"
      title="Bin"
      refusal={{
        title: 'The Bin is for admins',
        description:
          'It holds the facts an admin moved out of the library. Ask the data team if a fact you need is missing.',
      }}
    >
      <BinPage />
    </AudienceGate>
  )
}
