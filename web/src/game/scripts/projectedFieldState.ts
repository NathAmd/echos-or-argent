import { applyHgssUiTheme } from '../ui/hgssUiThemes'
import { cloneFieldScriptState, type FieldScriptState } from './fieldScriptRunner'

/**
 * Commits a projected script state without replacing the long-lived state
 * object held by the world, menu and save runtimes.
 */
export function applyProjectedFieldState(target: FieldScriptState, source: FieldScriptState, themeRoot: HTMLElement): void {
  const cloned = cloneFieldScriptState(source)
  target.mailboxMessageCount = source.mailboxMessageCount
  target.mailboxMailIdentities = [...source.mailboxMailIdentities]
  target.friendName = source.friendName
  target.friendNameSource = source.friendNameSource
  target.rivalName = source.rivalName
  target.rivalNameSource = source.rivalNameSource
  target.variables.clear()
  for (const [variableId, value] of source.variables) target.variables.set(variableId, value)
  target.flags.clear()
  for (const flag of source.flags) target.flags.add(flag)
  target.trainerFlags.clear()
  for (const trainerId of source.trainerFlags) target.trainerFlags.add(trainerId)
  target.engagedTrainers = source.engagedTrainers.map((trainer) => ({ ...trainer }))
  target.hiddenObjectIds.clear()
  for (const objectId of source.hiddenObjectIds) target.hiddenObjectIds.add(objectId)
  target.invisibleObjectIds.clear()
  for (const objectId of source.invisibleObjectIds) target.invisibleObjectIds.add(objectId)
  target.buffers.clear()
  for (const [bufferId, value] of source.buffers) target.buffers.set(bufferId, value)
  target.inventory.clear()
  for (const [itemId, quantity] of source.inventory) target.inventory.set(itemId, quantity)
  target.apricornBox = [...source.apricornBox]
  target.harvestedApricornTrees = new Set(source.harvestedApricornTrees)
  target.apricornTreeDay = source.apricornTreeDay
  target.badges.clear()
  for (const badge of source.badges) target.badges.add(badge)
  target.phoneContacts.clear()
  for (const contact of source.phoneContacts) target.phoneContacts.add(contact)
  target.phoneRematchSeeking.clear()
  for (const contact of source.phoneRematchSeeking) target.phoneRematchSeeking.add(contact)
  target.phoneGiftItems.clear()
  for (const [contact, itemId] of source.phoneGiftItems) target.phoneGiftItems.set(contact, itemId)
  target.phoneCallTriggers = new Set(source.phoneCallTriggers)
  target.momGiftItems = [...source.momGiftItems]
  target.pokegearCards.clear()
  for (const card of source.pokegearCards) target.pokegearCards.add(card)
  target.pokegearMapUnlockLevel = source.pokegearMapUnlockLevel
  target.pokegear = cloned.pokegear
  applyHgssUiTheme(themeRoot, target.pokegear.skin)
  target.friendRosterCount = source.friendRosterCount
  target.friendGroups = cloned.friendGroups
  target.easyChatTrendySayings = new Set(source.easyChatTrendySayings)
  target.easyChatMailMessages = source.easyChatMailMessages.map((message) => [...message] as [number, number])
  target.battleGreetingWords = [...source.battleGreetingWords] as FieldScriptState['battleGreetingWords']
  target.fashionPortraits = new Set(source.fashionPortraits)
  target.fashionPortraitEasyChatWords = new Map(source.fashionPortraitEasyChatWords)
  target.fashionAccessories = new Map(source.fashionAccessories)
  target.fashionBackgrounds = new Set(source.fashionBackgrounds)
  target.trainerHouseEntries = cloned.trainerHouseEntries
  target.daycare = cloned.daycare
  target.roamers = cloned.roamers
  target.favoritePokemon = { ...source.favoritePokemon }
  target.money = source.money
  target.coins = source.coins
  target.athletePoints = source.athletePoints
  target.battlePoints = source.battlePoints
  target.battlePointsReceived = source.battlePointsReceived
  target.battlePointsSpent = source.battlePointsSpent
  target.pokeathlonRecords = [...source.pokeathlonRecords]
  target.pokeathlonDataCards = new Set(source.pokeathlonDataCards)
  target.bankBalance = source.bankBalance
  target.gameScore = source.gameScore
  target.gameStats = new Map(source.gameStats)
  target.frontierRecords = new Map(source.frontierRecords)
  target.frontierMilestoneRewards = new Set(source.frontierMilestoneRewards)
  target.judgeStatPosition = source.judgeStatPosition
  target.frontierChallengeState = source.frontierChallengeState
  target.battleHallUsedSpecies = new Set(source.battleHallUsedSpecies)
  target.frontierSession = source.frontierSession && {
    ...source.frontierSession,
    partySlots: [...source.frontierSession.partySlots],
    statTrainerMons: source.frontierSession.statTrainerMons.map((team) => team.map((pokemon) => ({ ...pokemon }))),
  }
  target.blackoutSpawn = source.blackoutSpawn
  target.timeOfDay = source.timeOfDay
  target.weather = source.weather
  target.party = cloned.party
  target.pokemonStorage = cloned.pokemonStorage
  target.pokedex = cloned.pokedex
  target.starterChoice = source.starterChoice
  target.starterStorySpeciesId = source.starterStorySpeciesId
  target.followMonActive = source.followMonActive
  target.followMonMovementPaused = source.followMonMovementPaused
  target.followMonInhibited = source.followMonInhibited
  target.followerMood = source.followerMood
  target.runningShoes = source.runningShoes
  target.mysteryGiftActive = source.mysteryGiftActive
  target.safariZone = cloned.safariZone
  target.safariProgression = cloned.safariProgression
  target.palPark = cloned.palPark
  target.bugContest = cloned.bugContest
  target.kurtApricornType = source.kurtApricornType
  target.kurtApricornQuantity = source.kurtApricornQuantity
  target.kurtBallId = source.kurtBallId
  target.togepiEggIdentity = source.togepiEggIdentity && { ...source.togepiEggIdentity }
  target.radioMusicSequenceId = source.radioMusicSequenceId
  target.poisonStepCounter = source.poisonStepCounter
  target.friendshipStepCounter = source.friendshipStepCounter
  target.playerState = source.playerState
  target.fieldSystemMode = source.fieldSystemMode
  target.activeLinkRulesetId = source.activeLinkRulesetId
  target.unionActivity = source.unionActivity
  target.multiplayerRemoteAvatars = source.multiplayerRemoteAvatars.map((avatar) => ({ ...avatar, player: { ...avatar.player } }))
  target.unionAvatarSpriteId = source.unionAvatarSpriteId
  target.gymmick = { type: source.gymmick.type, data: source.gymmick.data.slice() }
  target.player = { ...source.player }
  target.objects = new Map([...source.objects].map(([objectId, actor]) => [objectId, { ...actor }]))
  target.mapProps = source.mapProps.map((prop) => ({ ...prop }))
  target.mapLoadedAtMs = source.mapLoadedAtMs
  target.currentMapId = source.currentMapId
  target.previousMapId = source.previousMapId
  target.dynamicWarp = source.dynamicWarp && { ...source.dynamicWarp }
  target.pendingPhoneCall = source.pendingPhoneCall ? { ...source.pendingPhoneCall } : undefined
}
