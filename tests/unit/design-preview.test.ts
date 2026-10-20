import { describe, expect, it } from 'vitest'
import { designPreviewEnabled } from '@/lib/env'
import { isPageTemplateId, pageTemplates } from '@/design-preview/catalog'

describe('design preview', () => {
  it('is enabled under the test runner (a development mode) and has five page templates', () => {
    expect(designPreviewEnabled).toBe(true)
    expect(pageTemplates.map((template) => template.id)).toEqual([
      'list',
      'document',
      'overview',
      'empty',
      'workbench',
    ])
  })

  it('knows its templates', () => {
    expect(isPageTemplateId('list')).toBe(true)
    expect(isPageTemplateId('tokens')).toBe(false)
  })
})
