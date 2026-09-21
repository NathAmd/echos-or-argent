import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserUtilityMenuSelectionState,
  createDeferredBrowserUtilityMenuHost,
  type BrowserUtilityMenuHost,
} from './browserUtilityMenuHost'

describe('browser utility menu selection state', () => {
  it('starts from the native root selections without sharing transient form state', () => {
    const first = createBrowserUtilityMenuSelectionState()
    const second = createBrowserUtilityMenuSelectionState()

    expect(first).toMatchObject({
      teamSlot: 0,
      teamSummaryOpen: false,
      teamSummaryPage: 'stats',
      bagActionPopupOpen: false,
    })
    expect(first.pokedexSpeciesId).toBeUndefined()
    expect(first.bagItemId).toBeUndefined()

    first.pokedexForms.set(479, 3)
    first.teamSummaryOpen = true

    expect(second.pokedexForms.size).toBe(0)
    expect(second.teamSummaryOpen).toBe(false)
  })
})

describe('deferred browser utility menu host', () => {
  it('fails clearly before installation then forwards through its stable façade', () => {
    const deferred = createDeferredBrowserUtilityMenuHost()
    expect(() => deferred.render()).toThrow("L'hôte du menu utilitaire n'est pas initialisé.")

    const render = vi.fn()
    const host = { render } as unknown as BrowserUtilityMenuHost
    deferred.install(host)

    deferred.render()
    expect(deferred.require()).toBe(host)
    expect(render).toHaveBeenCalledOnce()
  })
})
