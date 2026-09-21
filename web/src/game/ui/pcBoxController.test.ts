import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokemonParty, type PokemonParty } from '../pokemon/pokemonParty'
import { createPokemonStorage, type PokemonStorage } from '../pokemon/pokemonStorage'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createPcBoxController, resolvePcBoxName, resolvePcModeLabel } from './pcBoxController'

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: (TestElement | string)[] = []
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, ((event: { target: TestElement }) => void)[]>()
  readonly tagName: string
  className = ''
  hidden = false
  max = 0
  parentElement: TestElement | undefined
  replacementCount = 0
  tabIndex = 0
  textContent: string | null = null
  type = ''
  value = 0
  focusCount = 0
  readonly classList = {
    add: (...tokens: string[]): void => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean))
      tokens.forEach((token) => names.add(token))
      this.className = [...names].join(' ')
    },
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  append(...children: (TestElement | string)[]): void {
    for (const child of children) {
      if (child instanceof TestElement) child.parentElement = this
      this.children.push(child)
    }
  }

  replaceChildren(...children: (TestElement | string)[]): void {
    this.replacementCount += 1
    this.children.splice(0)
    this.append(...children)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(type: string, listener: (event: { target: TestElement }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  closest<T extends Element = Element>(selector: string): T | null {
    if (selector === 'button' && this.tagName === 'BUTTON') return this as unknown as T
    return this.parentElement?.closest<T>(selector) ?? null
  }

  querySelectorAll<T extends Element = Element>(selector: string): T[] {
    if (selector !== 'button[data-pc-action]') return []
    return descendants(this).filter((element) => element.tagName === 'BUTTON' && element.dataset.pcAction !== undefined) as unknown as T[]
  }

  focus(): void {
    this.focusCount += 1
  }

  click(): void {
    this.dispatchClick(this)
  }

  private dispatchClick(target: TestElement): void {
    this.listeners.get('click')?.forEach((listener) => listener({ target }))
    this.parentElement?.dispatchClick(target)
  }
}

function installTestDom(): void {
  vi.stubGlobal('Element', TestElement)
  vi.stubGlobal('document', { createElement: (tagName: string) => new TestElement(tagName) })
}

function descendants(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap((child) => child instanceof TestElement ? descendants(child) : [])]
}

function findControl(root: TestElement, key: string, value?: string): TestElement {
  const match = descendants(root).find((element) => element.dataset[key] !== undefined && (value === undefined || element.dataset[key] === value))
  if (!match) throw new Error(`Contrôle PC ${key} absent du DOM de test.`)
  return match
}

function findSlot(root: TestElement, kind: 'party' | 'box', slot: number): TestElement {
  const match = descendants(root).find((element) => element.dataset.pcKind === kind && element.dataset.pcSlot === String(slot))
  if (!match) throw new Error(`Emplacement PC ${kind}:${slot} absent du DOM de test.`)
  return match
}

function createPokemon(speciesId: number): CanonicalPokemon {
  return {
    instanceId: `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
    speciesId, speciesName: `ESPECE ${speciesId}`, form: 0, personality: speciesId,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    level: 5, experience: 125,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0, gender: 'male', abilityId: 1, shiny: false, friendship: 70, moves: [],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp: 20, status: 0, heldItemId: 0, ballId: 4, isEgg: false, fatefulEncounter: false, shinyLeafMask: 0, ribbonIds: [],
  }
}

function createControllerFixture(
  boxNames: readonly string[] | undefined = Array.from({ length: 18 }, (_, index) => `BOITE ${index + 1}`),
  teamPolicy?: PokemonTeamPolicy,
): {
  controller: ReturnType<typeof createPcBoxController>
  root: TestElement
  createPokemonIcon: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onRender: ReturnType<typeof vi.fn>
  takeHeldItem: ReturnType<typeof vi.fn>
  readParty: () => PokemonParty
  readStorage: () => PokemonStorage
} {
  let party = createPokemonParty([createPokemon(152), createPokemon(155)])
  let storage = createPokemonStorage([[createPokemon(158)]])
  const root = new TestElement('section')
  root.hidden = true
  const createPokemonIcon = vi.fn(() => new TestElement('canvas') as unknown as HTMLElement)
  const onClose = vi.fn()
  const onRender = vi.fn()
  const takeHeldItem = vi.fn((pokemon: CanonicalPokemon) => { pokemon.heldItemId = 0; return true })
  const pokemonCatalog = createPokemonTestCatalog()
  pokemonCatalog.natureNames = Array.from({ length: 25 }, (_, id) => `NATURE ${id}`)
  pokemonCatalog.abilityNames = Array.from({ length: 124 }, (_, id) => `TALENT ${id}`)
  const controller = createPcBoxController(root as unknown as HTMLElement, {
    readContext: () => ({
      party,
      storage,
      pokemonCatalog,
      typeNames: Array.from({ length: 18 }, (_, id) => `TYPE ${id}`),
      boxNames,
      playerName: 'JO',
      romMessages: { 63: '{103 0,0}', 69: 'DEPLACER', 75: 'ETEINDRE' },
      storageMessages: { 60: 'EQUIPE', 61: 'DEPLACER', 64: 'BOUGER OBJ.', 65: 'RESUME', 68: 'RELACHER', 69: 'RETIRER', 70: 'DEPOSER', 72: 'CONFIRM.', 73: 'ANNULER', 80: 'SAC', 92: 'VIDE' },
      partyMessages: { 23: 'N.', 28: 'PV' },
      summaryMessages: { 109: 'APTITUDES', 110: 'PV', 111: 'Attaque', 112: 'Défense', 113: 'Atq. Spé.', 114: 'Déf. Spé.', 115: 'Vitesse', 116: 'Cap. Spé.' },
    }),
    teamPolicy,
    createPokemonIcon,
    createHeldItemIcon: () => undefined,
    getItemName: () => undefined,
    takeHeldItem,
    onCommit: (nextParty, nextStorage) => { party = nextParty; storage = nextStorage },
    onCurrentBoxChange: (box) => { storage.currentBox = box },
    onRender,
    onClose,
  })
  return { controller, root, createPokemonIcon, onClose, onRender, takeHeldItem, readParty: () => party, readStorage: () => storage }
}

afterEach(() => vi.unstubAllGlobals())

describe('nom des boîtes PC', () => {
  it('affiche sans transformation le nom décodé de la ROM', () => {
    expect(resolvePcBoxName(['Boîte Prairie', 'Boîte Mer'], 1)).toBe('Boîte Mer')
  })

  it('n’invente aucun nom lorsque la donnée ROM est absente', () => {
    expect(resolvePcBoxName(undefined, 0)).toBe('')
    expect(resolvePcBoxName([''], 0)).toBe('')
  })
})

describe('libellé du mode PC', () => {
  it('utilise et nettoie le message natif de la ROM', () => {
    expect(resolvePcModeLabel({ 67: 'DÉPOSER\nPOKéMON' }, 0)).toBe('DÉPOSER POKéMON')
  })

  it('n’invente aucun mode lorsque la banque ROM est absente', () => {
    expect(resolvePcModeLabel(undefined, 2)).toBe('')
  })
})

describe('contrat DOM des Boîtes PC', () => {
  it('construit la structure une fois, synchronise la boîte en place et applique un focus roving aux emplacements', () => {
    installTestDom()
    const { controller, root, onRender } = createControllerFixture()

    controller.open()
    const header = root.children[0]
    const partyIcon = findSlot(root, 'party', 0).children.find((child) => child instanceof TestElement && child.tagName === 'CANVAS')
    const slots = descendants(root).filter((element) => element.dataset.pcKind !== undefined)

    expect(root.replacementCount).toBe(1)
    expect(slots.filter(({ tabIndex }) => tabIndex === 0)).toEqual([findSlot(root, 'box', 0)])
    expect(slots.filter(({ tabIndex }) => tabIndex === -1)).toHaveLength(35)

    controller.handle('page-next')

    expect(root.replacementCount).toBe(1)
    expect(root.children[0]).toBe(header)
    expect(findSlot(root, 'party', 0).children).toContain(partyIcon)
    expect(findControl(root, 'pcPage', 'previous').getAttribute('aria-label')).toBe('BOITE 1')
    expect(findControl(root, 'pcPage', 'next').getAttribute('aria-label')).toBe('BOITE 3')
    expect(onRender).toHaveBeenCalledTimes(2)

    controller.close()
    controller.open()
    expect(root.replacementCount).toBe(1)
  })

  it('expose A et B comme contrôles réels sans prompt décoratif, et garde les keycaps LB/RB sans donnée ROM', () => {
    installTestDom()
    const { controller, root, onClose } = createControllerFixture([])
    controller.open()

    const footer = descendants(root).find(({ className }) => className === 'pc-box-footer')!
    const keycaps = descendants(footer).filter(({ tagName }) => tagName === 'KBD').map(({ textContent }) => textContent)
    const activate = findControl(root, 'pcActivate')
    const close = findControl(root, 'pcClose')
    const previous = findControl(root, 'pcPage', 'previous')
    const next = findControl(root, 'pcPage', 'next')

    expect(footer.children).toEqual([activate, close])
    expect(keycaps).toEqual(['A', 'B'])
    expect(descendants(close).some(({ textContent }) => textContent === 'ETEINDRE')).toBe(true)
    expect(descendants(root).some(({ textContent }) => textContent === '✳')).toBe(false)
    expect(previous.getAttribute('aria-label')).toBeNull()
    expect(next.getAttribute('aria-label')).toBeNull()
    expect(previous.children[0]).toMatchObject({ textContent: 'LB' })
    expect(next.children[0]).toMatchObject({ textContent: 'RB' })

    activate.click()
    findControl(root, 'pcAction', 'move').click()
    expect(findSlot(root, 'box', 0).getAttribute('aria-pressed')).toBe('true')
    close.click()
    expect(root.hidden).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('met à jour uniquement les emplacements touchés après un transfert et conserve les canvas inchangés', () => {
    installTestDom()
    const { controller, root, createPokemonIcon, readParty, readStorage } = createControllerFixture()
    controller.open()
    const firstPartySlot = findSlot(root, 'party', 0)
    const firstPartyIcon = firstPartySlot.children.find((child) => child instanceof TestElement && child.tagName === 'CANVAS')
    const firstBoxSlot = findSlot(root, 'box', 0)

    controller.handle('confirm')
    findControl(root, 'pcAction', 'withdraw').click()
    controller.handle('down')
    controller.handle('down')
    controller.handle('confirm')

    expect(root.replacementCount).toBe(1)
    expect(findSlot(root, 'party', 0)).toBe(firstPartySlot)
    expect(firstPartySlot.children).toContain(firstPartyIcon)
    expect(findSlot(root, 'box', 0)).toBe(firstBoxSlot)
    expect(readParty().members.map(({ speciesId }) => speciesId)).toEqual([152, 155, 158])
    expect(readStorage().boxes[0]?.[0]).toBeUndefined()
    expect(findSlot(root, 'party', 2).tabIndex).toBe(0)
    expect(createPokemonIcon).toHaveBeenCalledTimes(4)
  })

  it('conserve exactement le transfert natif avec la policy de base implicite ou explicite', () => {
    installTestDom()
    const implicit = createControllerFixture()
    const explicit = createControllerFixture(undefined, basePokemonTeamPolicy)

    for (const fixture of [implicit, explicit]) {
      fixture.controller.open()
      fixture.controller.handle('confirm')
      findControl(fixture.root, 'pcAction', 'withdraw').click()
      fixture.controller.handle('down')
      fixture.controller.handle('down')
      fixture.controller.handle('confirm')
    }

    expect(implicit.readParty()).toEqual(explicit.readParty())
    expect(implicit.readStorage()).toEqual(explicit.readStorage())
    expect(implicit.readParty().members.map(({ speciesId }) => speciesId)).toEqual([152, 155, 158])
  })

  it('présente les veto autoritaires sans publier retrait, dépôt, réordonnancement ni libération', () => {
    installTestDom()
    const reason = 'Cette équipe est verrouillée.'
    const vetoPartyMutation = vi.fn<PokemonTeamPolicy['vetoPartyMutation']>(() => ({ code: 'team-locked', reason }))
    const policy: PokemonTeamPolicy = { vetoBattleEligibility: () => undefined, vetoPartyMutation }

    const withdrawal = createControllerFixture(undefined, policy)
    withdrawal.controller.open()
    withdrawal.controller.handle('confirm')
    findControl(withdrawal.root, 'pcAction', 'withdraw').click()
    withdrawal.controller.handle('down')
    withdrawal.controller.handle('down')
    withdrawal.controller.handle('confirm')

    const deposit = createControllerFixture(undefined, policy)
    deposit.controller.open()
    deposit.controller.handle('left')
    deposit.controller.handle('confirm')
    findControl(deposit.root, 'pcAction', 'deposit').click()
    deposit.controller.handle('right')
    deposit.controller.handle('confirm')

    const reorder = createControllerFixture(undefined, policy)
    reorder.controller.open()
    reorder.controller.handle('left')
    reorder.controller.handle('confirm')
    findControl(reorder.root, 'pcAction', 'move').click()
    reorder.controller.handle('down')
    reorder.controller.handle('confirm')

    const release = createControllerFixture(undefined, policy)
    release.controller.open()
    release.controller.handle('left')
    release.controller.handle('confirm')
    findControl(release.root, 'pcAction', 'release').click()
    release.controller.handle('down')
    release.controller.handle('confirm')

    for (const fixture of [withdrawal, deposit, reorder, release]) {
      expect(fixture.readParty().members.map(({ speciesId }) => speciesId)).toEqual([152, 155])
      expect(fixture.readStorage().boxes[0]?.[0]?.speciesId).toBe(158)
      expect(descendants(fixture.root).find(({ className }) => className === 'pc-box-notice')?.textContent).toBe(reason)
    }
    expect(vetoPartyMutation.mock.calls.map(([intent]) => intent.reason)).toEqual(['pc', 'pc', 'reorder', 'pc'])
  })

  it('garde une case occupée identifiable lorsque son aperçu ROM est indisponible', () => {
    installTestDom()
    const { controller, root, createPokemonIcon } = createControllerFixture()
    createPokemonIcon.mockReturnValue(undefined)

    controller.open()

    const occupied = findSlot(root, 'box', 0)
    const fallback = descendants(occupied).find(({ className }) => className === 'pc-pokemon-icon-fallback')
    expect(occupied.dataset.occupied).toBe('true')
    expect(fallback?.textContent).toBe('ESPECE 158')
    expect(findSlot(root, 'box', 29).dataset.occupied).toBe('false')
  })

  it('propose les actions ROM seulement après la sélection du Pokémon et confirme une libération sur ANNULER', () => {
    installTestDom()
    const { controller, root, readStorage } = createControllerFixture()
    controller.open()
    expect(descendants(root).some(({ dataset }) => dataset.pcAction !== undefined)).toBe(false)

    controller.handle('confirm')
    expect(findControl(root, 'pcAction', 'move').textContent).toBe('DEPLACER')
    expect(findControl(root, 'pcAction', 'summary').textContent).toBe('RESUME')
    expect(findControl(root, 'pcAction', 'release').textContent).toBe('RELACHER')
    findControl(root, 'pcAction', 'release').click()

    expect(findControl(root, 'pcAction', 'cancel').getAttribute('aria-current')).toBe('true')
    expect(findControl(root, 'pcAction', 'release-confirm').textContent).toBe('CONFIRM.')
    controller.handle('down')
    controller.handle('confirm')
    expect(readStorage().boxes[0]?.[0]).toBeUndefined()
  })

  it('ouvre depuis la boîte la même lecture visuelle des IV et EV que le résumé normal', () => {
    installTestDom()
    const { controller, root } = createControllerFixture()
    controller.open()
    controller.handle('confirm')
    findControl(root, 'pcAction', 'summary').click()

    const overview = descendants(root).find(({ className }) => className === 'pokemon-summary-training-overview')
    const bars = descendants(root).filter(({ tagName, attributes }) => tagName === 'PROGRESS' && attributes.has('aria-label'))
    expect(descendants(overview!).filter(({ tagName }) => tagName === 'SPAN').map(({ textContent }) => textContent)).toEqual(['IV 0,0 / 10', 'EV 0 / 510'])
    expect(bars.filter(({ attributes }) => attributes.get('aria-label')?.startsWith('IV '))).toHaveLength(6)
    expect(bars.filter(({ attributes }) => attributes.get('aria-label')?.startsWith('EV '))).toHaveLength(6)

    controller.handle('cancel')
    expect(descendants(root).some(({ className }) => className === 'pokemon-summary-training-overview')).toBe(false)
    expect(controller.isOpen()).toBe(true)
  })

  it('déplace ou reprend un objet tenu depuis le même menu contextuel', () => {
    installTestDom()
    const { controller, root, readStorage, takeHeldItem } = createControllerFixture()
    readStorage().boxes[0]![0]!.heldItemId = 17
    controller.open()
    controller.handle('confirm')

    expect(findControl(root, 'pcAction', 'move-item').textContent).toBe('BOUGER OBJ.')
    findControl(root, 'pcAction', 'take-item').click()
    expect(takeHeldItem).toHaveBeenCalledOnce()
    expect(readStorage().boxes[0]?.[0]?.heldItemId).toBe(0)
  })
})
