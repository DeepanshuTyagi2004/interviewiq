import { describe, expect, it } from 'vitest'
import { TOOLBAR_HALF_WIDTH, TOOLBAR_HEIGHT, placeToolbar } from './toolbarPlacement'

const box = { boxWidth: 600, clipTop: 0 }

describe('placeToolbar', () => {
  it('puts the toolbar above a selection that has room above it', () => {
    expect(placeToolbar({ top: 80, bottom: 100, center: 300, ...box })).toEqual({ top: 80, left: 300, placement: 'above' })
  })

  it('puts it below a selection too close to the top of the panel, where the panel would cut it off', () => {
    expect(placeToolbar({ top: 4, bottom: 24, center: 300, ...box })).toEqual({ top: 24, left: 300, placement: 'below' })
    // the room above is measured from the panel's visible top edge, which moves up as the box scrolls
    expect(placeToolbar({ top: 100, bottom: 120, center: 300, boxWidth: 600, clipTop: 90 }).placement).toBe('below')
    expect(placeToolbar({ top: 100, bottom: 120, center: 300, boxWidth: 600, clipTop: 0 }).placement).toBe('above')
  })

  it('needs the toolbar height and a small gap above before it goes above', () => {
    expect(placeToolbar({ top: TOOLBAR_HEIGHT + 5, bottom: 100, center: 300, ...box }).placement).toBe('below')
    expect(placeToolbar({ top: TOOLBAR_HEIGHT + 6, bottom: 100, center: 300, ...box }).placement).toBe('above')
  })

  it('keeps the toolbar inside the box sideways when the selection is near an edge', () => {
    expect(placeToolbar({ top: 80, bottom: 100, center: 5, ...box }).left).toBe(TOOLBAR_HALF_WIDTH)
    expect(placeToolbar({ top: 80, bottom: 100, center: 598, ...box }).left).toBe(600 - TOOLBAR_HALF_WIDTH)
  })

  it('centres on the selection when the box is narrower than the toolbar', () => {
    expect(placeToolbar({ top: 80, bottom: 100, center: 40, boxWidth: 90, clipTop: 0 }).left).toBe(40)
  })
})
