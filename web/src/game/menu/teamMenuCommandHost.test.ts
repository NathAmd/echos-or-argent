import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldTextEntryCoordinator } from '../ui/fieldTextEntryCoordinator'
import type { GameTextEntryOverlay, GameTextEntryRequest } from '../ui/gameTextEntryOverlay'
import type { HgssItemCatalog, HgssItemData } from '../../rom/items/itemData'
import { parseMainMenuCommand } from './mainMenuCommand'
import type { MainMenuCommand, MainMenuResult, MainMenuState } from './mainMenuController'
import {
  createTeamMenuCommandHost,
  type TeamMenuCommandHostPorts,
  type TeamMenuCommandResources,
} from './teamMenuCommandHost'

const menuState: MainMenuState = {
  open: true,
  screen: 'team',
  cursor: 0,
  items: [],
}
const closedMenuState: MainMenuState = { ...menuState, open: false }

function commandResult(command: MainMenuCommand): MainMenuResult {
  return { kind: 'command', command, state: menuState }
}

function createPokemon(
  speciesId: number,
  options: Readonly<{ nickname?: string, heldItemId?: number, isEgg?: boolean, mailIdentity?: 'kenya' }> = {},
): CanonicalPokemon {
  return {
    instanceId: `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
    speciesId,
    speciesName: speciesId === 152 ? 'GERMIGNON' : 'HERICENDRE',
    nickname: options.nickname,
    heldItemId: options.heldItemId ?? 0,
    mailIdentity: options.mailIdentity,
    isEgg: options.isEgg ?? false,
    currentHp: 20,
    moves: [],
  } as unknown as CanonicalPokemon
}

function createItemCatalog(): HgssItemCatalog {
  const items: HgssItemData[] = []
  items[17] = {
    itemId: 17,
    name: 'BAIE ORAN',
    fieldPocket: 4,
  } as HgssItemData
  items[137] = {
    itemId: 137,
    name: 'COURRIER HERBE',
    fieldPocket: 5,
  } as HgssItemData
  return { items, pocketNames: [] }
}

function createResources(): TeamMenuCommandResources {
  return {
    itemCatalog: createItemCatalog(),
    pokemonCatalog: createPokemonTestCatalog(),
    uiMessageBanks: {
      249: { 1: 'Donner un nouveau surnom à {101 0,0} ?' },
    },
  }
}

function createFixture(options: Readonly<{
  policy?: PokemonTeamPolicy
  party?: CanonicalPokemon[]
  mailbox?: Array<CanonicalPokemon['mailIdentity']>
}> = {}) {
  const party = {
    members: options.party ?? [createPokemon(152), createPokemon(155)],
  }
  const bagInventory = new Map<number, number>()
  const mailbox = options.mailbox ?? Array.from<CanonicalPokemon['mailIdentity']>({ length: 20 })
  let mailboxMessageCount = mailbox.filter((identity) => identity !== undefined).length
  const confirmationRequests: Array<{
    message: string
    resolve: (confirmed: boolean) => void
  }> = []
  let resources: TeamMenuCommandResources | undefined = createResources()
  let sweetScentResult = false
  let surfResult = false
  let pendingNicknameSlot: number | undefined

  const label = { textContent: '' }
  const count = { textContent: '' }
  const cancel = { hidden: true, disabled: true }
  const nicknameRoot = {
    hidden: true,
    querySelector: (selector: string) => {
      if (selector === 'label') return label
      if (selector === '.field-nickname-count') return count
      if (selector === '[data-nickname-cancel]') return cancel
      return null
    },
  } as unknown as HTMLElement
  const inputAttributes = new Map<string, string>()
  const nicknameInput = {
    maxLength: 0,
    value: '',
    setAttribute: (name: string, value: string) => { inputAttributes.set(name, value) },
    getAttribute: (name: string) => inputAttributes.get(name) ?? null,
  } as unknown as HTMLInputElement
  const nicknameRequests: GameTextEntryRequest[] = []
  const textEntryOverlay = {
    isOpen: () => false,
    open: (request: GameTextEntryRequest) => { nicknameRequests.push(request) },
  } as GameTextEntryOverlay
  const textEntry = createFieldTextEntryCoordinator({
    nicknameRoot,
    nicknameInput,
    numberInput: {} as HTMLInputElement,
    textEntry: textEntryOverlay,
    submitNickname: vi.fn(),
    submitNumber: vi.fn(),
  })

  const close = vi.fn(() => closedMenuState)
  const refresh = vi.fn(() => menuState)
  const render = vi.fn()
  const syncTeamSelection = vi.fn()
  const setHidden = vi.fn()
  const clearNotice = vi.fn()
  const selectPartySlot = vi.fn()
  const openSummary = vi.fn()
  const syncFollower = vi.fn()
  const useSweetScent = vi.fn(() => sweetScentResult)
  const offerSurf = vi.fn(() => surfResult)
  const setPendingPartySlot = vi.fn((partySlot: number) => { pendingNicknameSlot = partySlot })
  const persist = vi.fn()
  const setStatus = vi.fn()
  const setFieldStatus = vi.fn()
  const ports: TeamMenuCommandHostPorts = {
    menu: { close, refresh, render, syncTeamSelection, setHidden },
    team: {
      readParty: () => party,
      policy: options.policy ?? basePokemonTeamPolicy,
      clearNotice,
      selectPartySlot,
      openSummary,
      syncFollower,
    },
    bag: { readInventory: () => bagInventory },
    mailbox: {
      read: () => ({ identities: mailbox, messageCount: mailboxMessageCount }),
      writeMessageCount: (messageCount) => { mailboxMessageCount = messageCount },
    },
    confirmation: {
      request: (message, resolve) => { confirmationRequests.push({ message, resolve }) },
    },
    resources: { read: () => resources },
    fieldMoves: { useSweetScent, offerSurf },
    nickname: { root: nicknameRoot, input: nicknameInput, textEntry, setPendingPartySlot },
    persist,
    setStatus,
    setFieldStatus,
  }

  return {
    host: createTeamMenuCommandHost(ports),
    party,
    bagInventory,
    mailbox,
    confirmationRequests,
    readMailboxMessageCount: () => mailboxMessageCount,
    nicknameRoot,
    nicknameInput,
    nicknameRequests,
    label,
    count,
    cancel,
    close,
    refresh,
    render,
    syncTeamSelection,
    setHidden,
    clearNotice,
    selectPartySlot,
    openSummary,
    syncFollower,
    useSweetScent,
    offerSurf,
    setPendingPartySlot,
    persist,
    setStatus,
    setFieldStatus,
    readPendingNicknameSlot: () => pendingNicknameSlot,
    setResources: (next: TeamMenuCommandResources | undefined) => { resources = next },
    setSweetScentResult: (next: boolean) => { sweetScentResult = next },
    setSurfResult: (next: boolean) => { surfResult = next },
  }
}

describe('team menu command host', () => {
  it('ignores menu states and commands owned by another domain', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'state', state: menuState })).toBe(false)
    expect(fixture.host.handle(commandResult('save'))).toBe(false)
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.persist).not.toHaveBeenCalled()
  })

  it('selects a team member and clears the previous utility notice', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(commandResult('team-member:1'))).toBe(true)
    expect(fixture.clearNotice).toHaveBeenCalledOnce()
    expect(fixture.selectPartySlot).toHaveBeenCalledWith(1)
    expect(fixture.syncTeamSelection).toHaveBeenCalledWith(menuState)
    expect(fixture.render).not.toHaveBeenCalled()
  })

  it('accepts an already parsed summary command and opens the stats page', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(parseMainMenuCommand('team-summary:1'))).toBe(true)
    expect(fixture.openSummary).toHaveBeenCalledWith(1, 'stats')
    expect(fixture.render).toHaveBeenCalledWith(menuState)
  })

  it.each([
    ['team-move-down:0' as const, 1, 'GERMIGNON occupe maintenant l’emplacement 2.'],
    ['team-move-up:1' as const, 0, 'HERICENDRE occupe maintenant l’emplacement 1.'],
  ])('reorders and persists %s', (command, targetSlot, message) => {
    const fixture = createFixture()
    const movedSpecies = command.startsWith('team-move-down') ? 152 : 155

    expect(fixture.host.handle(commandResult(command))).toBe(true)
    expect(fixture.party.members[targetSlot]?.speciesId).toBe(movedSpecies)
    expect(fixture.selectPartySlot).toHaveBeenCalledWith(targetSlot)
    expect(fixture.syncFollower).toHaveBeenCalledWith(true)
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.setStatus).toHaveBeenCalledWith(message, 'success')
    expect(fixture.render).toHaveBeenCalledWith(menuState)
    expect(fixture.syncFollower.mock.invocationCallOrder[0]).toBeLessThan(fixture.persist.mock.invocationCallOrder[0]!)
    expect(fixture.persist.mock.invocationCallOrder[0]).toBeLessThan(fixture.setStatus.mock.invocationCallOrder[0]!)
  })

  it('keeps party order atomic when the team policy vetoes reordering', () => {
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'locked', reason: 'Ordre verrouillé.' }),
    }
    const fixture = createFixture({ policy })

    expect(fixture.host.handle(commandResult('team-move-down:0'))).toBe(true)
    expect(fixture.party.members.map(({ speciesId }) => speciesId)).toEqual([152, 155])
    expect(fixture.persist).not.toHaveBeenCalled()
    expect(fixture.syncFollower).not.toHaveBeenCalled()
    expect(fixture.setStatus).toHaveBeenCalledWith('Ordre verrouillé.', 'warning')
    expect(fixture.render).toHaveBeenCalledWith(menuState)
  })

  it('returns the held item to the bag with the original success message', () => {
    const fixture = createFixture({
      party: [createPokemon(152, { nickname: 'FEUILLE', heldItemId: 17 })],
    })

    expect(fixture.host.handle(commandResult('team-take-item:0'))).toBe(true)
    expect(fixture.party.members[0]?.heldItemId).toBe(0)
    expect(fixture.bagInventory.get(17)).toBe(1)
    expect(fixture.setStatus).toHaveBeenCalledWith(
      'FEUILLE remet BAIE ORAN dans le Sac.',
      'success',
    )
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenCalledWith(menuState)
  })

  it('préserve le courrier Kenya dans la première case libre après confirmation', () => {
    const mailbox = Array.from<CanonicalPokemon['mailIdentity']>({ length: 20 })
    mailbox[0] = 'kenya'
    const fixture = createFixture({
      mailbox,
      party: [createPokemon(152, { heldItemId: 137, mailIdentity: 'kenya' })],
    })

    expect(fixture.host.handle(commandResult('team-take-item:0'))).toBe(true)
    expect(fixture.confirmationRequests).toHaveLength(1)
    expect(fixture.party.members[0]).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })

    fixture.confirmationRequests[0]!.resolve(true)

    expect(fixture.mailbox.slice(0, 3)).toEqual(['kenya', 'kenya', undefined])
    expect(fixture.readMailboxMessageCount()).toBe(2)
    expect(fixture.party.members[0]).toMatchObject({ heldItemId: 0, mailIdentity: undefined })
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Le courrier a été envoyé dans la boîte aux lettres du PC.',
      'success',
    )
  })

  it('conserve le courrier lorsque la boîte aux lettres est pleine', () => {
    const fixture = createFixture({
      mailbox: Array.from({ length: 20 }, () => 'kenya' as const),
      party: [createPokemon(152, { heldItemId: 137, mailIdentity: 'kenya' })],
    })

    fixture.host.handle(commandResult('team-take-item:0'))
    fixture.confirmationRequests[0]!.resolve(true)

    expect(fixture.party.members[0]).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })
    expect(fixture.persist).not.toHaveBeenCalled()
    expect(fixture.setStatus).toHaveBeenLastCalledWith('La boîte aux lettres du PC est pleine.', 'warning')
  })

  it('ne détruit le texte du courrier qu’après la seconde confirmation de retour au Sac', () => {
    const fixture = createFixture({
      party: [createPokemon(152, { heldItemId: 137, mailIdentity: 'kenya' })],
    })

    fixture.host.handle(commandResult('team-take-item:0'))
    fixture.confirmationRequests[0]!.resolve(false)
    expect(fixture.confirmationRequests).toHaveLength(2)
    expect(fixture.party.members[0]).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })

    fixture.confirmationRequests[1]!.resolve(true)

    expect(fixture.bagInventory.get(137)).toBe(1)
    expect(fixture.party.members[0]).toMatchObject({ heldItemId: 0, mailIdentity: undefined })
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.setStatus).toHaveBeenLastCalledWith('Le courrier a été remis dans le Sac.', 'success')
  })

  it('reports stale team item context without mutating or persisting', () => {
    const fixture = createFixture({ party: [] })
    fixture.setResources(undefined)

    expect(fixture.host.handle(commandResult('team-take-item:0'))).toBe(true)
    expect(fixture.setStatus).toHaveBeenCalledWith(
      'Le Pokémon ou le catalogue ROM n’est plus disponible.',
      'warning',
    )
    expect(fixture.persist).not.toHaveBeenCalled()
    expect(fixture.render).toHaveBeenCalledWith(menuState)
  })

  it('lets Sweet Scent consume the command before closing the menu', () => {
    const fixture = createFixture()
    fixture.setSweetScentResult(true)

    expect(fixture.host.handle(commandResult('team-field-move:0:230'))).toBe(true)
    expect(fixture.useSweetScent).toHaveBeenCalledOnce()
    expect(fixture.close).not.toHaveBeenCalled()
    expect(fixture.offerSurf).not.toHaveBeenCalled()
    expect(fixture.setFieldStatus).not.toHaveBeenCalled()
  })

  it('closes the menu before offering Surf', () => {
    const fixture = createFixture()
    fixture.setSurfResult(true)

    expect(fixture.host.handle(commandResult('team-field-move:1:57'))).toBe(true)
    expect(fixture.render).toHaveBeenCalledWith(closedMenuState)
    expect(fixture.offerSurf).toHaveBeenCalledWith(1)
    expect(fixture.setFieldStatus).not.toHaveBeenCalled()
    expect(fixture.render.mock.invocationCallOrder[0]).toBeLessThan(fixture.offerSurf.mock.invocationCallOrder[0]!)
  })

  it('keeps the field failure message for unsupported directions and moves', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(commandResult('team-field-move:0:15'))).toBe(true)
    expect(fixture.render).toHaveBeenCalledWith(closedMenuState)
    expect(fixture.setFieldStatus).toHaveBeenCalledWith(
      'Cette capacité ne peut pas être utilisée dans cette direction.',
    )
  })

  it('opens the centralized nickname entry with ROM text and current name', () => {
    const fixture = createFixture({
      party: [createPokemon(152, { nickname: 'FEUILLE' })],
    })

    expect(fixture.host.handle(commandResult('team-rename:0'))).toBe(true)
    expect(fixture.readPendingNicknameSlot()).toBe(0)
    expect(fixture.setPendingPartySlot).toHaveBeenCalledWith(0)
    expect(fixture.nicknameInput.maxLength).toBe(10)
    expect(fixture.nicknameInput.value).toBe('FEUILLE')
    expect(fixture.count.textContent).toBe('7/10')
    expect(fixture.label.textContent).toBe('Donner un nouveau surnom à FEUILLE ?')
    expect(fixture.nicknameInput.getAttribute('aria-label')).toBe('Donner un nouveau surnom à FEUILLE ?')
    expect(fixture.cancel).toMatchObject({ hidden: false, disabled: false })
    expect(fixture.setHidden).toHaveBeenCalledWith(true)
    expect(fixture.nicknameRoot.hidden).toBe(false)
    expect(fixture.nicknameRequests).toHaveLength(1)
    expect(fixture.nicknameRequests[0]).toMatchObject({
      mode: 'name',
      title: 'Donner un nouveau surnom à FEUILLE ?',
      maxLength: 10,
      cancellable: true,
    })
  })

  it('rejects missing Pokémon and Eggs before opening nickname input', () => {
    const fixture = createFixture({ party: [createPokemon(152, { isEgg: true })] })

    expect(fixture.host.handle(commandResult('team-rename:0'))).toBe(true)
    expect(fixture.setStatus).toHaveBeenCalledWith('Ce Pokémon ne peut pas être renommé.', 'warning')
    expect(fixture.render).toHaveBeenCalledWith(menuState)
    expect(fixture.nicknameRequests).toHaveLength(0)
    expect(fixture.setHidden).not.toHaveBeenCalled()
  })
})
