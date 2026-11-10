import { useQuery } from '@tanstack/react-query'
import { installQuery } from '@/api/queries'
import { Badge } from '@/components/ui/badge'
import { TruncatedText } from '@/components/heed/truncated'
import { cn } from '@/lib/utils'

/**
 * The label that names this install (HEED_PROFILE_LABEL), on the sign-in page and in every page's
 * header, so a person who runs more than one install, the demo and a private profile say, always
 * sees which one they are in. Nothing when none is set.
 */
export function ProfileLabel({ className }: { className?: string }) {
  const label = useQuery(installQuery()).data?.profileLabel
  if (!label) return null
  return (
    <Badge
      variant="outline"
      data-profile-label
      className={cn('max-w-48 font-normal text-muted-foreground', className)}
    >
      <span className="sr-only">This install: </span>
      <TruncatedText text={label} className="min-w-0" />
    </Badge>
  )
}
