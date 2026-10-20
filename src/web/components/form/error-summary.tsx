import { useEffect, useId, useRef } from 'react'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CircleAlertIcon } from '@/components/icons'
import { fieldControlId, type FormError } from '@/lib/form-errors'
import { cn } from '@/lib/utils'

/**
 * The list of problems at the top of a form (contract 9.9): shown after a submit with more than
 * two errors, each a link that moves focus to its field. It takes focus when it appears, or
 * when `attempt` changes (each new submit), so a keyboard or screen reader user lands on it.
 *
 * A link finds its field by `fieldControlId(field)` unless `idFor` says otherwise; give each
 * control that id.
 */
export function ErrorSummary({
  errors,
  attempt = 0,
  title,
  idFor = fieldControlId,
  className,
}: {
  errors: readonly (FormError & { label?: string })[]
  /** Changes with each submit, so focus returns to the summary every time. */
  attempt?: number
  title?: string
  idFor?: (field: string) => string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const count = errors.length
  const hasErrors = count > 0

  useEffect(() => {
    if (hasErrors) ref.current?.focus()
  }, [attempt, hasErrors])

  if (count === 0) return null

  return (
    <Alert
      ref={ref}
      variant="danger"
      role="alert"
      tabIndex={-1}
      aria-labelledby={titleId}
      data-slot="error-summary"
      className={cn('outline-offset-2', className)}
    >
      <CircleAlertIcon aria-hidden />
      <AlertContent>
        <AlertTitle id={titleId}>
          {title ?? `Fix ${count === 1 ? 'this problem' : `these ${count} problems`} first`}
        </AlertTitle>
        <AlertDescription>
          <ul className="flex flex-col gap-1">
            {errors.map((error) => (
              <li key={error.field}>
                <a
                  href={`#${idFor(error.field)}`}
                  onClick={(event) => {
                    const target = document.getElementById(idFor(error.field))
                    if (!target) return
                    event.preventDefault()
                    target.scrollIntoView?.({ block: 'center' })
                    target.focus({ preventScroll: true })
                  }}
                  className="underline underline-offset-4 hover:no-underline"
                >
                  {error.label ? `${error.label}: ${error.message}` : error.message}
                </a>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}
