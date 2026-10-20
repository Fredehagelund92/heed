import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@/lib/utils'

function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & {
  /** xs 20 (dense rows), sm 24 (comfortable rows), default 32 (menus), lg 40 (contract 4.5, 7.1). */
  size?: 'default' | 'xs' | 'sm' | 'lg'
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=xs]:size-5 dark:after:mix-blend-lighten',
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
        'flex size-full items-center justify-center rounded-full bg-muted text-dense font-bold text-muted-foreground group-data-[size=sm]/avatar:text-caption group-data-[size=xs]/avatar:text-caption',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback }
