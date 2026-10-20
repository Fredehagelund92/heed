import { type Control, type FieldValues, useFormState } from 'react-hook-form'
import { ErrorSummary } from '@/components/form/error-summary'
import {
  ERROR_SUMMARY_THRESHOLD,
  fieldControlId,
  formErrorsFromFieldErrors,
} from '@/lib/form-errors'

/**
 * The error summary of a React Hook Form form: after a submit with more than two errors it
 * lists them in page order, with each field's label, and takes focus. With one or two errors
 * the messages under the fields are enough.
 */
export function FormErrorSummary<T extends FieldValues>({
  control,
  order = [],
  labels = {},
  idFor = fieldControlId,
}: {
  control: Control<T>
  /** The fields in the order they appear, so the list reads top to bottom. */
  order?: readonly string[]
  /** Each field's label, to start its line: "Domain: Choose a domain." */
  labels?: Readonly<Record<string, string>>
  idFor?: (field: string) => string
}) {
  const { errors, submitCount } = useFormState({ control })
  const list = formErrorsFromFieldErrors(errors, order)
  if (submitCount === 0 || list.length < ERROR_SUMMARY_THRESHOLD) return null
  return (
    <ErrorSummary
      attempt={submitCount}
      idFor={idFor}
      errors={list.map((error) => ({ ...error, label: labelFor(error.field, labels) }))}
    />
  )
}

function labelFor(field: string, labels: Readonly<Record<string, string>>): string | undefined {
  let best: string | undefined
  let bestLength = -1
  for (const [name, label] of Object.entries(labels)) {
    if ((field === name || field.startsWith(`${name}.`)) && name.length > bestLength) {
      best = label
      bestLength = name.length
    }
  }
  return best
}
