import { describe, expect, it } from 'vitest'
import { createMainMenuController } from './mainMenuController'

describe('createMainMenuController', () => {
  it('expose le multijoueur comme commande burger uniquement quand l’hôte l’autorise', () => {
    const solo = createMainMenuController()
    expect(solo.open().items.some(({ id }) => id === 'multiplayer')).toBe(false)

    const online = createMainMenuController(() => ({ multiplayer: true }))
    const state = online.open()
    const index = state.items.findIndex(({ id }) => id === 'multiplayer')
    expect(index).toBeGreaterThan(-1)
    expect(online.select(index)).toMatchObject({
      kind: 'command',
      command: 'multiplayer',
      state: { open: true, screen: 'root' },
    })
  })

  it('n’affiche la sortie Safari native que lorsque le contexte l’autorise', () => {
    let safari = false
    const menu = createMainMenuController(() => ({ retire: safari }))
    expect(menu.open().items.some(({ id }) => id === 'retire')).toBe(false)
    safari = true
    expect(menu.refresh().items.at(-1)).toMatchObject({ id: 'retire', kind: 'command' })
    expect(menu.select(menu.getState().items.length - 1)).toMatchObject({ kind: 'command', command: 'retire' })
  })

  it('ouvre le menu racine avec un focus deterministe', () => {
    const menu = createMainMenuController()

    menu.handle('menu')

    expect(menu.getState()).toMatchObject({ open: true, screen: 'root', cursor: 0 })
    expect(menu.getState().items.map((item) => item.id)).toEqual([
      'pokedex', 'team', 'bag', 'pokegear', 'options',
    ])
  })

  it('navigue la liste racine dans les quatre directions et confirme la selection courante', () => {
    const menu = createMainMenuController()
    menu.open()

    menu.handle('right')
    expect(menu.getState().cursor).toBe(1)
    menu.handle('down')
    expect(menu.getState().cursor).toBe(2)
    menu.handle('up')
    menu.handle('left')

    expect(menu.handle('confirm')).toMatchObject({ kind: 'state', state: { screen: 'pokedex' } })
  })

  it('revient à la racine depuis une page puis ferme depuis la racine', () => {
    const menu = createMainMenuController()
    menu.open()
    menu.select(1)

    menu.handle('cancel')
    expect(menu.getState()).toMatchObject({ open: true, screen: 'root', cursor: 1 })
    menu.handle('cancel')
    expect(menu.getState()).toMatchObject({ open: false, screen: 'root' })
  })

  it('fait de chaque application Pokématos une page enfant du burger Pokématos', () => {
    const menu = createMainMenuController(() => ({}), (screen) => {
      if (screen === 'pokegear') return [
        { id: 'pokegear-phone', label: 'Téléphone', kind: 'screen' },
        { id: 'pokegear-map', label: 'Carte', kind: 'screen' },
      ]
      if (screen === 'pokegear-map') return []
      return undefined
    })
    menu.open()

    menu.select(3)
    expect(menu.getState().items.map(({ id }) => id)).toEqual(['pokegear-phone', 'pokegear-map', 'root'])
    menu.select(1)
    expect(menu.getState()).toMatchObject({ screen: 'pokegear-map' })
    expect(menu.getState().items.map(({ id }) => id)).toEqual(['pokegear'])

    menu.handle('cancel')
    expect(menu.getState()).toMatchObject({ screen: 'pokegear', cursor: 1 })
    menu.handle('cancel')
    expect(menu.getState()).toMatchObject({ screen: 'root', cursor: 3 })
  })

  it('synchronise le focus pointe et revient à la racine avec son bouton retour', () => {
    const menu = createMainMenuController()
    menu.open()

    menu.focus(4)
    expect(menu.select(4)).toMatchObject({ kind: 'state', state: { screen: 'options', cursor: 0 } })
    expect(menu.getState().items.map((item) => item.id)).toEqual([
      'cycle-text-speed', 'toggle-battle-animations', 'toggle-local-weather', 'toggle-fullscreen', 'save',
      'report-bug', 'emergency-unstick', 'new-game', 'root',
    ])
    menu.select(8)

    expect(menu.getState()).toMatchObject({ open: true, screen: 'root', cursor: 4 })
  })

  it('déclenche les réglages Options avec le même contrat au clavier, à la manette et au clic', () => {
    const keyboard = createMainMenuController()
    keyboard.handle('menu')
    keyboard.focus(4)
    keyboard.handle('confirm')
    expect(keyboard.handle('confirm')).toMatchObject({ kind: 'command', command: 'cycle-text-speed' })

    const gamepad = createMainMenuController()
    gamepad.handle('menu')
    gamepad.focus(4)
    gamepad.handle('confirm')
    gamepad.handle('down')
    expect(gamepad.handle('confirm')).toMatchObject({ kind: 'command', command: 'toggle-battle-animations' })

    const pointer = createMainMenuController()
    pointer.open()
    pointer.select(4)
    pointer.focus(2)
    expect(pointer.select(2)).toMatchObject({ kind: 'command', command: 'toggle-local-weather' })
  })

  it('réserve haut/bas à la navigation Options et gauche/droite au réglage courant', () => {
    const menu = createMainMenuController()
    menu.open()
    menu.select(4)

    expect(menu.handle('right')).toMatchObject({ kind: 'command', command: 'cycle-text-speed', optionDirection: 1 })
    expect(menu.getState().cursor).toBe(0)
    menu.handle('down')
    expect(menu.handle('left')).toMatchObject({ kind: 'command', command: 'toggle-battle-animations', optionDirection: -1 })
    menu.focus(4)
    expect(menu.handle('right')).toEqual({ kind: 'ignored' })
  })

  it('emet les commandes sans coupler leur execution au controleur', () => {
    const menu = createMainMenuController()
    menu.open()
    menu.select(4)

    expect(menu.select(4)).toMatchObject({ kind: 'command', command: 'save' })
    expect(menu.getState()).toMatchObject({ open: true, screen: 'options' })
  })

  it('exclut les rubriques verrouillees par la progression au moment de l’ouverture', () => {
    let hasStarter = false
    const menu = createMainMenuController(() => ({ pokedex: false, team: hasStarter, pokegear: false, map: false, save: false }))

    menu.open()
    expect(menu.getState().items.map((item) => item.id)).toEqual(['bag', 'options'])

    menu.close()
    hasStarter = true
    menu.open()
    expect(menu.getState().items.map((item) => item.id)).toEqual(['team', 'bag', 'options'])
  })

  it('ne couvre pas le terrain quand aucune rubrique n’est encore disponible', () => {
    const menu = createMainMenuController(() => ({
      pokedex: false, team: false, bag: false, pokegear: false, map: false, save: false, options: false,
    }))

    expect(menu.open()).toMatchObject({ open: false, screen: 'root', items: [] })
  })

  it('garde la sauvegarde dans Options masquée tant que son drapeau reste verrouillé', () => {
    let canSave = false
    const menu = createMainMenuController(() => ({ save: canSave }))

    menu.open()
    expect(menu.getState().items.map((item) => item.id)).toEqual([
      'pokedex', 'team', 'bag', 'pokegear', 'options',
    ])
    menu.select(4)
    expect(menu.getState().items.map((item) => item.id)).not.toContain('save')

    canSave = true
    menu.refresh()
    expect(menu.getState().items.map((item) => item.id)).toContain('save')
  })

  it('navigue dans les entrees dynamiques d’un sous-ecran avec le meme focus', () => {
    const menu = createMainMenuController(() => ({}), (screen) => screen === 'bag' ? [
      { id: 'bag-item:4', label: 'Poké Ball × 2', kind: 'command' },
      { id: 'bag-item:17', label: 'Potion × 1', kind: 'command' },
    ] : undefined)
    menu.open()
    menu.select(2)

    expect(menu.getState().items.map((item) => item.id)).toEqual(['bag-item:4', 'bag-item:17', 'root'])
    menu.handle('down')
    expect(menu.handle('confirm')).toMatchObject({ kind: 'command', command: 'bag-item:17' })
    expect(menu.handle('cancel')).toMatchObject({ kind: 'state', state: { open: true, screen: 'root', cursor: 2 } })
  })

  it('rafraîchit les commandes dynamiques sans perdre l’écran courant', () => {
    let quantity = 2
    const menu = createMainMenuController(() => ({}), (screen) => screen === 'bag' ? [
      { id: 'bag-item:17', label: `Potion × ${quantity}`, kind: 'command' },
    ] : undefined)
    menu.open()
    menu.select(2)
    menu.focus(1)
    quantity = 1

    expect(menu.refresh()).toMatchObject({ open: true, screen: 'bag', cursor: 1 })
    expect(menu.getState().items[0]?.label).toBe('Potion × 1')
  })

  it('retrouve le focus par commande quand des lignes dynamiques sont insérées', () => {
    let showPocket = false
    const menu = createMainMenuController(() => ({}), (screen) => screen === 'bag' ? [
      ...(showPocket ? [{ id: 'bag-pocket:1' as const, label: 'Médicaments', kind: 'command' as const }] : []),
      { id: 'bag-item:17', label: 'Potion', kind: 'command' },
    ] : undefined)
    menu.open()
    menu.select(2)
    menu.focus(0)
    showPocket = true

    expect(menu.refresh()).toMatchObject({ screen: 'bag', cursor: 1 })
    expect(menu.getState().items[menu.getState().cursor]?.id).toBe('bag-item:17')
  })
})
