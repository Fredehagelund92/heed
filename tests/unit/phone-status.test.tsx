import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RowStatus } from '@/components/library/status-icon'
import { TooltipProvider } from '@/components/ui/tooltip'

describe('phone status', () => {
  it('keeps a healthy status accessible without repeating the label', () => {
    render(
      <TooltipProvider>
        <RowStatus status="accepted" />
      </TooltipProvider>,
    )
    expect(screen.getByRole('img', { name: 'Accepted' })).toBeInTheDocument()
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument()
  })

  it.each([
    ['source_missing', 'Source missing'],
    ['active_issue', 'Active issue'],
  ] as const)('keeps the words for %s', (status, label) => {
    render(
      <TooltipProvider>
        <RowStatus status={status} />
      </TooltipProvider>,
    )
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
