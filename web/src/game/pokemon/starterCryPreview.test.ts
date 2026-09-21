import { describe, expect, it, vi } from 'vitest'
import { createStarterCryPreview } from './starterCryPreview'

describe('starter cry preview', () => {
  it('maps choices to HGSS species and suppresses duplicate previews', async () => {
    const playCry = vi.fn(async () => undefined)
    const preview = createStarterCryPreview(playCry)

    await expect(preview.preview(0)).resolves.toBe(true)
    await expect(preview.preview(0)).resolves.toBe(false)
    await expect(preview.preview(1)).resolves.toBe(true)
    await expect(preview.preview(2)).resolves.toBe(true)
    expect(playCry.mock.calls).toEqual([[152, 0], [155, 0], [158, 0]])
  })

  it('allows replay after reset or a failed audio request', async () => {
    const playCry = vi.fn()
      .mockRejectedValueOnce(new Error('audio'))
      .mockResolvedValue(undefined)
    const preview = createStarterCryPreview(playCry)

    await expect(preview.preview(1)).rejects.toThrow('audio')
    await expect(preview.preview(1)).resolves.toBe(true)
    preview.reset()
    await expect(preview.preview(1)).resolves.toBe(true)
    expect(playCry).toHaveBeenCalledTimes(3)
  })

  it('rejects choices outside the native starter table', async () => {
    const preview = createStarterCryPreview(async () => undefined)
    await expect(preview.preview(3)).rejects.toThrow('choix de starter HGSS 3')
  })
})
