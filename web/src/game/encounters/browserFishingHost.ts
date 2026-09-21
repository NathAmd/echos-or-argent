import type { GameDigitalAction } from '../../gameInput'
import type {
  NitroTexturePreview,
  PlayerGender,
  PlayerTextureFrames,
  PokemonCatalog,
  RomInventory,
} from '../../ndsTypes'
import type { HgssFishingBiteEffectAsset } from './hgssFishingBiteEffect'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonParty } from '../pokemon/pokemonParty'
import { HGSS_SAFARI_MAP_ID } from '../safari/hgssSafariMap'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'
import type { WorldState } from '../world/worldSession'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { FieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import { createHgssFishingSession, type HgssFishingSession } from './hgssFishingSession'
import {
  prepareHgssFishingWildEncounter,
  type HgssFishingRod,
  type PreparedFieldWildEncounter,
  type PreparedSafariWildEncounter,
} from './wildEncounterSelection'

const fishingMessageIds = [37, 49, 50, 51, 52] as const
const maximumGameStatistic = 0xffff_ffff

type BrowserFishingInventory = Pick<
  RomInventory,
  'eventTextureResolver' | 'fishingBiteEffectResolver' | 'uiMessageBanks' | 'wildEncounterCatalog'
>

export type BrowserFishingPokemonRuntime = Readonly<{
  catalog: PokemonCatalog
  rng: HgssLcrng
  now: () => Date
}>

export type BrowserFishingFieldState = {
  party: PokemonParty
  followMonActive: boolean
  followerMood: number
  safariZone: Readonly<{ session: Readonly<{ active: boolean }> }>
  gameStats: Map<number, number>
}

export type BrowserFishingPlayer = Readonly<{
  name: string
  gender: PlayerGender
}>

export type BrowserFishingHostPorts = Readonly<{
  sources: Readonly<{
    readWorld: () => WorldState | undefined
    readPokemonRuntime: () => BrowserFishingPokemonRuntime | undefined
    readInventory: () => BrowserFishingInventory | undefined
    readFieldState: () => BrowserFishingFieldState
    readPlayer: () => BrowserFishingPlayer
    isFacingSurfableSurface: () => boolean
  }>
  encounters: Readonly<{
    identityPort: FieldWildEncounterIdentityPort
    prepareSafariEncounter: (
      rod: HgssFishingRod,
    ) => PreparedSafariWildEncounter | undefined
    materializePreparedEncounter: (
      prepared: PreparedFieldWildEncounter,
    ) => CanonicalPokemon | undefined
    startPreparedEncounter: (
      prepared: PreparedFieldWildEncounter,
      materialized?: CanonicalPokemon,
    ) => boolean
  }>
  presentation: Readonly<{
    clearMovementInput: () => void
    setFollowerMovementPaused: (paused: boolean) => void
    setPlayerTextureFrames: (frames: PlayerTextureFrames) => void
    setPlayerTexture: (preview: NitroTexturePreview) => void
    applyCurrentPlayerSkin: (force?: boolean) => void
    startFishingBiteEffect: (
      target: 'player' | 'follower',
      effect: HgssFishingBiteEffectAsset,
    ) => void
    stopFishingBiteEffect: (target?: 'player' | 'follower') => void
    setStatus: (text: string) => void
  }>
  dialogue: Readonly<{
    showMessages: (message: string, options?: Readonly<{ speaker?: string }>) => void
    hide: () => void
  }>
  audio: Readonly<{
    playSoundEffect: (sequenceId: number) => Promise<unknown> | undefined
  }>
  persistence: Readonly<{
    scheduleAutosave: (delayMs?: number) => void
  }>
}>

export type BrowserFishingHost = Readonly<{
  tryStart: (itemId: number) => boolean
  handle: (action: GameDigitalAction) => boolean
  tick: () => void
  cancel: () => void
  isActive: () => boolean
}>

function resolveFishingRod(itemId: number): HgssFishingRod | undefined {
  if (itemId === 445) return 'oldRod'
  if (itemId === 446) return 'goodRod'
  if (itemId === 447) return 'superRod'
  return undefined
}

/** Possède la session de pêche et adapte ses effets ROM au runtime navigateur. */
export function createBrowserFishingHost(ports: BrowserFishingHostPorts): BrowserFishingHost {
  let activeSession: HgssFishingSession | undefined
  let activeBiteTarget: 'player' | 'follower' | undefined

  const incrementGameStatistic = (statisticId: number): void => {
    const statistics = ports.sources.readFieldState().gameStats
    statistics.set(
      statisticId,
      Math.min(maximumGameStatistic, (statistics.get(statisticId) ?? 0) + 1),
    )
  }

  const restoreFieldPresentation = (): void => {
    ports.dialogue.hide()
    ports.presentation.setFollowerMovementPaused(false)
    ports.presentation.applyCurrentPlayerSkin(true)
  }

  const cancel = (): void => {
    if (!activeSession) return
    activeSession = undefined
    if (activeBiteTarget) ports.presentation.stopFishingBiteEffect(activeBiteTarget)
    activeBiteTarget = undefined
    restoreFieldPresentation()
  }

  const tryStart = (itemId: number): boolean => {
    const world = ports.sources.readWorld()
    const pokemonRuntime = ports.sources.readPokemonRuntime()
    const inventory = ports.sources.readInventory()
    if (!world || !pokemonRuntime || !inventory || activeSession) return false
    const fishingMessages = inventory.uiMessageBanks[40]
    if (!fishingMessageIds.every((messageId) => fishingMessages?.[messageId])) {
      throw new Error('Les messages ROM de pêche HGSS sont absents.')
    }
    if ((world.locomotion !== 'walking' && world.locomotion !== 'surfing')
      || !ports.sources.isFacingSurfableSurface()) {
      ports.presentation.setStatus(formatHgssRomMessage(
        fishingMessages[37]!,
        [ports.sources.readPlayer().name],
      ))
      return false
    }
    if (world.map.header.wildEncounterBank === 0xff) {
      ports.presentation.setStatus(formatHgssRomMessage(
        fishingMessages[37]!,
        [ports.sources.readPlayer().name],
      ))
      return false
    }
    const rod = resolveFishingRod(itemId)
    if (!rod) return false
    const encounterBank = world.map.header.wildEncounterBank
    const encounters = inventory.wildEncounterCatalog[encounterBank]
    if (!encounters) {
      throw new Error(`La banque ROM de pêche ${encounterBank} de ${world.map.label} est absente.`)
    }
    const fieldState = ports.sources.readFieldState()
    const followerActive = fieldState.followMonActive
    const firstAlive = fieldState.party.members.find(
      (pokemon) => !pokemon.isEgg && pokemon.currentHp > 0,
    )
    const selectedEncounter = prepareHgssFishingWildEncounter(
      encounters,
      rod,
      pokemonRuntime.now().getHours(),
      pokemonRuntime.rng,
      false,
      world.map.id === HGSS_SAFARI_MAP_ID && fieldState.safariZone.session.active
        ? ports.encounters.prepareSafariEncounter
        : undefined,
      fieldState.party.members[0],
      followerActive ? firstAlive?.friendship : undefined,
      (speciesId) => pokemonRuntime.catalog.personalData[speciesId]?.types,
    )
    const prepared = selectedEncounter && ports.encounters.identityPort(
      selectedEncounter,
      { mapId: world.map.id, source: 'fishing' },
    )
    const materialized = prepared
      ? ports.encounters.materializePreparedEncounter(prepared)
      : undefined
    ports.presentation.clearMovementInput()
    ports.presentation.setFollowerMovementPaused(true)
    const player = ports.sources.readPlayer()
    const resource = inventory.eventTextureResolver?.(player.gender === 'male' ? 188 : 189)
    if (resource?.frames) ports.presentation.setPlayerTextureFrames(resource.frames)
    if (resource?.preview) ports.presentation.setPlayerTexture(resource.preview)
    ports.presentation.setStatus('')
    activeSession = createHgssFishingSession({
      rod,
      hasEncounter: Boolean(prepared),
      rng: pokemonRuntime.rng,
      followerMood: followerActive ? fieldState.followerMood : undefined,
      followerFriendship: followerActive && world.locomotion !== 'surfing'
        ? firstAlive?.friendship
        : undefined,
      onCastSound: (sequenceId) => {
        void ports.audio.playSoundEffect(sequenceId)?.catch(() => undefined)
      },
      onBite: (target) => {
        activeBiteTarget = target
        ports.presentation.startFishingBiteEffect(target, inventory.fishingBiteEffectResolver())
      },
      onBiteEnd: (target) => {
        ports.presentation.stopFishingBiteEffect(target)
        if (activeBiteTarget === target) activeBiteTarget = undefined
      },
      onMessage: (messageId) => {
        if (messageId === 50) incrementGameStatistic(101)
        ports.dialogue.showMessages(
          formatHgssRomMessage(fishingMessages[messageId]!, [ports.sources.readPlayer().name]),
          { speaker: undefined },
        )
      },
      onMessageDismiss: ports.dialogue.hide,
      onComplete: (result) => {
        activeSession = undefined
        activeBiteTarget = undefined
        restoreFieldPresentation()
        if (result === 'landed' && prepared) {
          incrementGameStatistic(11)
          ports.encounters.startPreparedEncounter(prepared, materialized)
        }
        ports.persistence.scheduleAutosave(0)
      },
    })
    return true
  }

  return Object.freeze({
    tryStart,
    handle: (action) => activeSession?.handle(action) ?? false,
    tick: () => { activeSession?.tick() },
    cancel,
    isActive: () => activeSession !== undefined,
  })
}
