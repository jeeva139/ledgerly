import { describe, expect, it } from 'vitest'
import { detectDateOrder } from '../electron/imports/common/dates'

describe('detectDateOrder: only ask the user when a date genuinely reads differently each way', () => {
  it('a day above 12 settles it', () => {
    expect(detectDateOrder(['15/10/2026', '03/04/2026'], 'MDY')).toMatchObject({ order: 'DMY', ambiguous: false })
    expect(detectDateOrder(['10/15/2026'], 'DMY')).toMatchObject({ order: 'MDY', ambiguous: false })
  })

  it('03/04/2026 with no other evidence is ambiguous (3 April or 4 March)', () => {
    expect(detectDateOrder(['03/04/2026', '05/06/2026'], 'DMY').ambiguous).toBe(true)
  })

  it('09/09/2026 means the same either way, so there is nothing to ask', () => {
    expect(detectDateOrder(['09/09/2026'], 'DMY').ambiguous).toBe(false)
    expect(detectDateOrder(['01/01/2026', '12/12/2026'], 'MDY').ambiguous).toBe(false)
  })

  it('contradictory evidence stays ambiguous', () => {
    expect(detectDateOrder(['15/10/2026', '10/15/2026'], 'DMY').ambiguous).toBe(true)
  })

  it('files without numeric dates are never ambiguous', () => {
    expect(detectDateOrder(['2026-10-15', '12 Oct 2026'], 'DMY').ambiguous).toBe(false)
  })
})
