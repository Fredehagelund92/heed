import { cva } from 'class-variance-authority'

/**
 * The look of a text input (contract 6.5 and 6.6): the default (32) reads in 13 like the other
 * toolbar controls and the table, `lg` (40) in 14 like the rest of a form, and a coarse pointer
 * gets 16 so iOS does not zoom. On its own so a native input outside a `Field` can
 * share it without loading Base UI's input. `Input` (input.tsx) uses it.
 */
export const inputVariants = cva(
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-dense transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-dense file:font-bold file:text-foreground placeholder:text-muted-foreground read-only:bg-muted/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive max-md:min-h-control-touch max-md:text-large dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 pointer-coarse:h-control-touch pointer-coarse:text-large',
  {
    variants: {
      size: {
        default: 'h-control-md',
        lg: 'h-control-lg text-body',
      },
    },
    defaultVariants: { size: 'default' },
  },
)
