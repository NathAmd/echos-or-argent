import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../../ndsTypes'
import type { CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { PokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import { createDoubleBattleCommandSelectionState } from '../doubleBattleCommandSelection'
import type { DoubleBattleSession } from '../doubleBattleSession'
import { createBrowserDoubleBattleSceneHost } from './browserDoubleBattleSceneHost'

class TestElement {
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  disabled = false
  hidden = false
  textContent: string | null = null
  type = ''

  replaceChildren(...children: TestElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }

  querySelector(): null {
    return null
  }

  querySelectorAll(): TestElement[] {
    return []
  }
}

function pokemon(instanceId: string, speciesName: string, moveRange: number): CanonicalPokemon {
  return {
    instanceId,
    speciesName,
    currentHp: 20,
    stats: { hp: 20 },
    isEgg: false,
    moves: [{ data: { range: moveRange } }],
  } as unknown as CanonicalPokemon
}

function battle(player: CanonicalPokemon, opponent: CanonicalPokemon): DoubleBattleSession {
  return {
    kind: 'double',
    phase: 'command',
    teams: {
      player: [{
        ownerId: 'player',
        party: [player],
        activePartyIndex: 0,
        controlled: true,
        volatile: {},
      }],
      opponent: [{
        ownerId: 'opponent',
        party: [opponent],
        activePartyIndex: 0,
        controlled: false,
        volatile: {},
      }],
    },
  } as unknown as DoubleBattleSession
}

function createFixture(moveRange: number) {
  vi.stubGlobal('document', {
    createElement: () => new TestElement(),
  })
  const player = pokemon('player-1', 'HÉRICENDRE', moveRange)
  const opponent = pokemon('opponent-1', 'GERMIGNON', 0)
  const session = battle(player, opponent)
  const moves = new TestElement()
  let selection = createDoubleBattleCommandSelectionState()
  const setUiMode = vi.fn()
  const setCursor = vi.fn()
  const renderCursor = vi.fn()
  const selectTarget = vi.fn()
  const resources = {
    pokemonCatalog: { moves: [] },
    uiMessageBanks: { 6: { 6: 'CIBLE', 28: 'PV' } },
  } as unknown as RomInventory
  const inert = new TestElement() as unknown as HTMLElement
  const host = createBrowserDoubleBattleSceneHost({
    elements: {
      screen: inert,
      playerSprite: inert,
      opponentSprite: inert,
      playerParty: inert,
      opponentParty: inert,
      message: new TestElement() as unknown as HTMLElement,
      commands: inert,
      moves: moves as unknown as HTMLElement,
    },
    readContext: () => ({
      battle: session,
      resources,
      selection,
      teamPolicy: {} as PokemonTeamPolicy,
      vblank: 0,
    }),
    setSelection: (next) => { selection = next },
    setCommandPresentation: vi.fn(),
    setUiMode,
    setCursor,
    renderCursor,
    getPokemonName: ({ speciesName }) => speciesName,
    getBagItemCount: () => 0,
    createPokemonIcon: () => undefined,
    selectTarget,
    syncHpZone: () => undefined,
    gaugeAnimationVersions: new WeakMap(),
    canvasAssets: { mountGraphicCanvas: vi.fn() },
    spriteAnimator: { registerDouble: vi.fn() },
  })
  return {
    host,
    moves,
    player,
    selection: () => selection,
    setUiMode,
    setCursor,
    renderCursor,
    selectTarget,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('host navigateur de la scène de combat double', () => {
  it('projette les cibles adverses dans un menu sans décider l’action', () => {
    const fixture = createFixture(0)

    expect(fixture.host.currentActor()).toEqual({ side: 'player', slot: 0 })
    fixture.host.showTargets(0)

    expect(fixture.selection().pendingMoveIndex).toBe(0)
    expect(fixture.setUiMode).toHaveBeenCalledWith('doubleTarget')
    expect(fixture.setCursor).toHaveBeenCalledWith(0)
    expect(fixture.moves.children).toHaveLength(1)
    expect(fixture.moves.children[0]?.dataset).toMatchObject({
      doubleTargetSide: 'opponent',
      doubleTarget: '0',
    })
    expect(fixture.moves.children[0]?.textContent).toBe('GERMIGNON · PV 20/20')
    expect(fixture.renderCursor).toHaveBeenCalledOnce()
    expect(fixture.selectTarget).not.toHaveBeenCalled()
  })

  it('redirige immédiatement une capacité de zone vers l’acteur canonique', () => {
    const fixture = createFixture(1 << 1)

    fixture.host.showTargets(0)

    expect(fixture.selection().pendingMoveIndex).toBe(0)
    expect(fixture.selectTarget).toHaveBeenCalledWith({ side: 'player', slot: 0 })
    expect(fixture.setUiMode).not.toHaveBeenCalled()
    expect(fixture.moves.children).toHaveLength(0)
  })
})
