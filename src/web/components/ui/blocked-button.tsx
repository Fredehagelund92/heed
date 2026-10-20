import { type ComponentProps, type ReactNode, useId } from 'react'
import { CircleSlashIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * A button that cannot act yet and says why (contract 7.1, 7.2 and 9.4, "blocked, never hidden").
 * It stays in the tab order with `aria-disabled`, so a keyboard or screen reader user finds it,
 * its reason is read with it (`aria-describedby`), and pressing it opens a popover with the reason
 * instead of doing nothing. Never colour alone: the label stays readable and the reason is words.
 */
export function BlockedButton({
  reason,
  title,
  children,
  className,
  variant = 'outline',
  size,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'disabled' | 'title'> & {
  /** One or two plain sentences: why it cannot act, and what will make it work. */
  reason: ReactNode
  /** A short heading for the popover: "Accept is blocked". Defaults to the label when it is plain text. */
  title?: ReactNode
}) {
  const reasonId = useId()
  const heading = title ?? (typeof children === 'string' ? `${children} is blocked` : null)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-disabled="true"
            aria-describedby={reasonId}
            data-blocked=""
            className={cn(
              'cursor-not-allowed text-muted-foreground hover:text-muted-foreground',
              (variant === 'default' || variant === 'destructive') && 'bg-muted hover:bg-muted',
              className,
            )}
            {...props}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
      <PopoverContent align="start" className="flex-row items-start gap-2">
        <CircleSlashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          {heading ? <PopoverTitle>{heading}</PopoverTitle> : null}
          <PopoverDescription className="text-dense">{reason}</PopoverDescription>
        </div>
      </PopoverContent>
    </Popover>
  )
}
