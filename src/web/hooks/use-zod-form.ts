import { zodResolver } from '@hookform/resolvers/zod'
import { type FieldValues, useForm, type UseFormProps } from 'react-hook-form'
import type * as z from 'zod/mini'

/**
 * A React Hook Form form checked by a `zod/mini` schema, with the validation timing of contract
 * 9.9: a field is checked when it loses focus, then on every change once it has shown an error;
 * a submit checks everything. Focus after a failed submit is the form's to place (the error
 * summary, or the first field), so the library does not move it.
 */
export function useZodForm<Schema extends z.ZodMiniType<FieldValues, FieldValues>>(
  schema: Schema,
  options: Omit<
    UseFormProps<z.input<Schema>, unknown, z.output<Schema>>,
    'resolver' | 'mode' | 'reValidateMode'
  > = {},
) {
  return useForm<z.input<Schema>, unknown, z.output<Schema>>({
    shouldFocusError: false,
    ...options,
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
}
