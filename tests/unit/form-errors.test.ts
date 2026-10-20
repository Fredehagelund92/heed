import type { FieldErrors } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import {
  fieldControlId,
  formErrorsFromFieldErrors,
  formErrorsFromFindings,
  formErrorsFromIssues,
  sortByOrder,
} from '@/lib/form-errors'

const order = ['kind', 'summary', 'scope', 'validity', 'evidence', 'areaId']

describe('form errors', () => {
  it('flattens a react-hook-form error tree into page order', () => {
    const errors = {
      areaId: { type: 'custom', message: 'Choose a domain.' },
      evidence: [{ url: { type: 'custom', message: 'Add a link.' } }],
      summary: { type: 'too_small', message: 'Say what happened.' },
      validity: { start: { type: 'custom', message: 'Enter the first day it applies.' } },
    } as unknown as FieldErrors
    expect(formErrorsFromFieldErrors(errors, order)).toEqual([
      { field: 'summary', message: 'Say what happened.' },
      { field: 'validity.start', message: 'Enter the first day it applies.' },
      { field: 'evidence.0.url', message: 'Add a link.' },
      { field: 'areaId', message: 'Choose a domain.' },
    ])
  })

  it('takes the service findings that are errors, one per field', () => {
    expect(
      formErrorsFromFindings(
        [
          {
            code: 'email_address',
            field: 'summary',
            message: 'Text matches email_address',
            severity: 'error',
          },
          { code: 'format', field: 'summary', message: 'Second', severity: 'error' },
          { code: 'style', field: 'kind', message: 'Just a warning', severity: 'warning' },
          {
            code: 'format',
            field: 'validity.start',
            message: 'Expected a date',
            severity: 'error',
          },
        ],
        order,
      ),
    ).toEqual([
      { field: 'summary', message: 'Text matches email_address' },
      { field: 'validity.start', message: 'Expected a date' },
    ])
  })

  it('takes zod issues, one per field', () => {
    expect(
      formErrorsFromIssues([
        { path: ['evidence', 0, 'quote'], message: 'Too long' },
        { path: ['evidence', 0, 'quote'], message: 'Again' },
        { path: [], message: 'Whole form' },
      ]),
    ).toEqual([
      { field: 'evidence.0.quote', message: 'Too long' },
      { field: '', message: 'Whole form' },
    ])
  })

  it('puts unknown fields last and keeps their order', () => {
    expect(
      sortByOrder(
        [
          { field: 'zeta', message: 'z' },
          { field: 'scope.metrics', message: 's' },
          { field: 'alpha', message: 'a' },
        ],
        order,
      ).map((error) => error.field),
    ).toEqual(['scope.metrics', 'zeta', 'alpha'])
  })

  it('makes a safe element id from a field path', () => {
    expect(fieldControlId('evidence.0.url')).toBe('field-evidence-0-url')
    expect(fieldControlId('summary')).toBe('field-summary')
  })
})
