import { Button } from "@/components/ui/button"

/** The one way a long list inside a page asks for more: "Show 10 more (24 not shown)". */
export function ShowMoreButton({
  more,
  next,
  onClick,
  label = "more",
  className,
}: {
  more: number
  next: number
  onClick: () => void
  label?: string
  className?: string
}) {
  if (more <= 0) return null
  return (
    <Button variant="ghost" size="sm" className={className ?? "-ml-2 h-7 w-fit text-xs"} onClick={onClick}>
      Show {next} {label}
      <span className="text-muted-foreground tabular-nums">({more} not shown)</span>
    </Button>
  )
}
