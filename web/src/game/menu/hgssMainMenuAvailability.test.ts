import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createMainMenuController } from './mainMenuController'
import { resolveHgssMainMenuAvailability } from './hgssMainMenuAvailability'

describe('disponibilité du menu terrain HGSS', () => {
  it('conserve uniquement l’entrée Online permettant de quitter pendant le verrou Coop', () => {
    const state = createFieldScriptState('male')
    state.flags.add(0x11e)
    state.flags.add(0x11d)

    const menu = createMainMenuController(() => resolveHgssMainMenuAvailability(state, {
      campaignLocked: true,
      fullscreenSupported: true,
      fullscreenInstalled: false,
    }))

    expect(menu.open().items.map(({ id }) => id)).toEqual(['multiplayer'])
  })

  it('restaure les commandes débloquées après la sortie Coop', () => {
    const state = createFieldScriptState('male')
    state.flags.add(0x11e)
    state.flags.add(0x11d)
    state.flags.add(0x11b)
    state.flags.add(0x9c)
    state.pokedex.enabled = true

    expect(resolveHgssMainMenuAvailability(state, {
      campaignLocked: false,
      fullscreenSupported: true,
      fullscreenInstalled: false,
    })).toMatchObject({
      pokedex: true,
      bag: true,
      pokegear: true,
      multiplayer: true,
      save: true,
      options: true,
      'toggle-fullscreen': true,
    })
  })
})
