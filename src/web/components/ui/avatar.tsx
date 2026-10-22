import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@/lib/utils'

function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & {
  /** xs 20 (chips), sm 28 (list and review rows), default 32 (the assistant chat), md 36 (the sidebar card), lg 40 (profiles). */
  size?: 'default' | 'xs' | 'sm' | 'md' | 'lg'
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-avatar-chat shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-avatar-profile data-[size=md]:size-avatar-card data-[size=sm]:size-avatar-row data-[size=xs]:size-avatar-chip dark:after:mix-blend-lighten',
        className,
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-avatar-chat font-bold text-muted-foreground group-data-[size=lg]/avatar:text-avatar-profile group-data-[size=md]/avatar:text-avatar-card group-data-[size=sm]/avatar:text-avatar-row group-data-[size=xs]/avatar:text-avatar-chip',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback }
