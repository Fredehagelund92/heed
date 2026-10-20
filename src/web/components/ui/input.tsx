import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { inputVariants } from './input-variants'

/**
 * A text input on Base UI, so a surrounding `Field` labels and describes it. The default (32)
 * is for toolbars, in 13; `lg` (40) is for forms on the paper and in dialogs, in 14 (contract 6.5
 * and 6.6). A coarse pointer gets 44 high and 16 text, so iOS does not zoom.
 */
function Input({
  className,
  type,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
