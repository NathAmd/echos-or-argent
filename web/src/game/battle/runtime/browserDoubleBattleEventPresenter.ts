import type { RomInventory } from '../../../ndsTypes'
import type { RomAudioRuntime } from '../../../audio/romAudioRuntime'
import type { PokemonTrainerIdentity } from '../../pokemon/canonicalPokemon'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../../pokemon/canonicalPokemon'
import type { PokemonPartySlotSource } from '../../pokemon/canonicalPokemonPartyTarget'
import type { DetailedBattleOutcomeObserver } from '../battleOutcomeObserver'
import { observeDoubleBattleOutcomeEvents } from '../battleOutcomeProjection'
import { collectBattleMoveDamageEvents } from '../battleEventPresentation'
import {
  createBattlePresentationLease,
  type BattlePresentationSkipRegistry,
} from '../battlePresentationSkip'
import {
  playConfirmedHgssBattleAnimation,
  type HgssBattleAnimationPlaybackDiagnostic,
  type HgssBattleAnimationSpritePlayback,
} from '../battleAnimationPlayback'
import { findHgssBattleVictoryFaintIndex, startHgssBattleVictoryMusic } from '../hgssBattleAudioPresentation'
import {
  resolveHgssBattleEventPresentationAnimation,
  type HgssBattlePresentationAnimation,
} from '../hgssBattlePresentationAnimation'
import { isHeldItemBattleCondition, resolveBattleConditionMessage } from '../battleConditionPresentation'
import {
  applyBattleStagePresentation,
  syncBattleHudPrimaryStatus,
  syncBattleProgressionHud,
  syncBattleStageSummary,
} from '../battleHudPresentation'
import { playBattleImpact, playBattlePokemonEntrance, playBattlePokemonFaint } from '../battleSceneAnimations'
import { isBattlePokemonSpriteBoundTo } from '../battlePokemonSpritePresentation'
import {
  clearDoubleBattleExperienceParticipation,
  getDoubleBattleExperienceParticipantIndexes,
  getDoubleBattleOccupiedPositions,
  type DoubleBattleEvent,
  type DoubleBattlePosition,
  type DoubleBattleSession,
} from '../doubleBattleSession'
import { resolveFieldBattleExperienceRecipients } from '../fieldBattleExperienceRecipients'
import type { BattleProgressionApplicator } from '../battleProgressionPolicy'
import type { BattleLevelUp } from '../battleProgression'
import {
  createBattleProgressionPokemonKey,
  type BattleProgressionPresentationQueue,
} from '../battleProgressionPresentationQueue'
import type {
  BattleProgressionMessageEntry,
  CanonicalBattleProgressionPresenter,
} from '../battleProgressionPresentation'
import { formatHgssRomMessage } from '../../ui/romMessageFormatting'
import type { BrowserDoubleBattleSceneHost } from './browserDoubleBattleSceneHost'

type BattleAnimationRun = Readonly<{
  finished: Promise<unknown>
  cancel: () => void
}>

export type BrowserDoubleBattleEventContext = Readonly<{
  battle?: DoubleBattleSession
  resources?: RomInventory
  player: PokemonTrainerIdentity
  nativeLanguage?: number
  currentLocationId?: number
  suppressProgression: boolean
  opponentTrainerIds: readonly number[]
  battleAnimations: boolean
  presentationGeneration: number
  audio?: RomAudioRuntime
  outcomeObserver: DetailedBattleOutcomeObserver
}>

export type BrowserDoubleBattleEventPresenterPorts = Readonly<{
  readContext: () => BrowserDoubleBattleEventContext
  scene: Pick<BrowserDoubleBattleSceneHost, 'element' | 'renderPosition' | 'showReplacement'>
  elements: Readonly<{
    screen: HTMLElement
    effects?: HTMLCanvasElement
  }>
  presentation: Readonly<{
    animateHp: (position: DoubleBattlePosition, amount: number) => Promise<void>
    playCondition: (position: DoubleBattlePosition, animation: HgssBattlePresentationAnimation) => void
    beginAction: (moveType: number) => void
    finishAction: () => void
    setMessageInputLocked: (locked: boolean) => void
    trackAnimation: (run: BattleAnimationRun | undefined) => void
    playSendOut: (position: DoubleBattlePosition, pokemon: CanonicalPokemon, sprite: HTMLElement, hud: HTMLElement) => void
    showLevelUpCard: (pokemon: CanonicalPokemon, level: BattleLevelUp) => void
    createSpriteEffectPlayback: () => HgssBattleAnimationSpritePlayback | undefined
    onAnimationDiagnostic?: (diagnostic: HgssBattleAnimationPlaybackDiagnostic) => void
    skip: BattlePresentationSkipRegistry
  }>
  progression: Readonly<{
    apply: BattleProgressionApplicator
    messagePresenter: CanonicalBattleProgressionPresenter
    deferred: BattleProgressionPresentationQueue<BattleProgressionMessageEntry>
    createEvolutionEntry: (
      pokemon: CanonicalPokemon,
      source: PokemonPartySlotSource,
    ) => BattleProgressionMessageEntry
    settleMoney: (result: 'won' | 'lost', ordinaryDouble: boolean) => string | undefined
  }>
  messages: Readonly<{
    replace: (entries: readonly BattleProgressionMessageEntry[]) => void
    append: (entries: readonly BattleProgressionMessageEntry[]) => void
    showNext: () => void
  }>
  protectEvents?: (
    battle: DoubleBattleSession,
    events: readonly DoubleBattleEvent[],
  ) => readonly DoubleBattleEvent[]
  markSeen: (pokemon: CanonicalPokemon) => void
  getPokemonName: (pokemon: CanonicalPokemon) => string
}>

export type BrowserDoubleBattleEventPresenter = Readonly<{
  queue: (events: readonly DoubleBattleEvent[], showImmediately?: boolean) => void
}>

/**
 * Transforme les événements déterministes du moteur double en une file de
 * messages et d'effets navigateur. La session reste possédée par le moteur ;
 * les mutations DOM, audio et progression passent toutes par des ports nommés.
 */
export function createBrowserDoubleBattleEventPresenter(
  ports: BrowserDoubleBattleEventPresenterPorts,
): BrowserDoubleBattleEventPresenter {
  function queue(inputEvents: readonly DoubleBattleEvent[], showImmediately = true): void {
    const context = ports.readContext()
    const { battle, resources } = context
    if (!battle || !resources) return
    const events = ports.protectEvents?.(battle, inputEvents) ?? inputEvents
    observeDoubleBattleOutcomeEvents(events, battle.teams, context.outcomeObserver)
    const victoryFaintIndex = findHgssBattleVictoryFaintIndex(events)
    const impact = (position: DoubleBattlePosition, damage: number) => {
      const { sprite, hud } = ports.scene.element(position)
      playBattleImpact({
        root: ports.elements.screen,
        sprite,
        damage,
        maximumHp: Number(hud.querySelector<HTMLProgressElement>('progress')?.max ?? 1),
      })
    }
    const entries: BattleProgressionMessageEntry[] = []

    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex]!
      if (event.kind === 'move') {
        const linkedDamages = collectBattleMoveDamageEvents(events, event)
        entries.push({
          text: `${event.pokemonName} utilise ${event.moveName}!`,
          onShow: () => {
            const playbackContext = ports.readContext()
            const script = resources.battleAnimationCatalog.moveScripts[event.moveId]
            const actorElement = ports.scene.element(event.actor).sprite
            const targetElement = ports.scene.element(event.target).sprite
            const playerBattlers = battle.teams.player.map((_participant, slot) => (
              ports.scene.element({ side: 'player', slot: slot as DoubleBattlePosition['slot'] }).sprite
            ))
            const opponentBattlers = battle.teams.opponent.map((_participant, slot) => (
              ports.scene.element({ side: 'opponent', slot: slot as DoubleBattlePosition['slot'] }).sprite
            ))
            const attackerBattlers = event.actor.side === 'player' ? playerBattlers : opponentBattlers
            const defenderBattlers = event.target.side === 'player' ? playerBattlers : opponentBattlers
            const surfaces = event.actor.side === 'player'
              ? {
                  player: actorElement,
                  opponent: targetElement,
                  additionalDefenders: linkedDamages.map(({ target }) => ports.scene.element(target).sprite),
                  attackerPartner: attackerBattlers.find((element) => element !== actorElement),
                  defenderPartner: defenderBattlers.find((element) => element !== targetElement),
                  playerBattlers,
                  opponentBattlers,
                  effects: ports.elements.effects,
                }
              : {
                  player: targetElement,
                  opponent: actorElement,
                  additionalDefenders: linkedDamages.map(({ target }) => ports.scene.element(target).sprite),
                  attackerPartner: attackerBattlers.find((element) => element !== actorElement),
                  defenderPartner: defenderBattlers.find((element) => element !== targetElement),
                  playerBattlers,
                  opponentBattlers,
                  effects: ports.elements.effects,
                }
            const generation = playbackContext.presentationGeneration
            const applyDamage = () => Promise.all(linkedDamages.map((linkedDamage) => {
              const current = ports.readContext()
              if (current.battle !== battle || current.presentationGeneration !== generation) return Promise.resolve()
              impact(linkedDamage.target, linkedDamage.damage)
              return ports.presentation.animateHp(linkedDamage.target, -linkedDamage.damage)
            }))
            if (!playbackContext.battleAnimations || !script) {
              void applyDamage()
              return
            }
            ports.presentation.setMessageInputLocked(true)
            ports.presentation.beginAction(event.moveType)
            const lease = createBattlePresentationLease(ports.presentation.skip)
            const audio = playbackContext.audio
            void playConfirmedHgssBattleAnimation(
              script,
              event.actor.side,
              surfaces,
              audio ? {
                playSoundEffect: audio.playSoundEffect,
                playPannedSoundEffect: audio.playPannedSoundEffect,
                playMovingSoundEffect: audio.playMovingSoundEffect,
                stopSoundEffect: audio.stopSoundEffect,
                playPokemonCry: (side, modulation, pan, volume) => {
                  const speciesId = side === event.actor.side ? event.actorSpeciesId : event.targetSpeciesId
                  return audio.playCry(speciesId, modulation, pan, volume)
                },
                isPokemonCryPlaying: audio.isCryPlaying,
              } : undefined,
              resources.battleAnimationCatalog.particleResourceResolver,
              {
                friendlyFire: event.actor.side === event.target.side,
                signal: lease.signal,
                onDiagnostic: ports.presentation.onAnimationDiagnostic,
              },
              ports.presentation.createSpriteEffectPlayback(),
            ).catch(() => undefined).then(applyDamage).finally(() => {
              lease.close()
              const current = ports.readContext()
              if (current.battle === battle && current.presentationGeneration === generation) {
                ports.presentation.finishAction()
              }
            })
          },
        })
      }
      if (event.kind === 'miss') entries.push(`${event.pokemonName} rate son attaque!`)
      else if (event.kind === 'damage') {
        if (event.movePresentationId === undefined) {
          entries.push({
            text: 'Le Pokémon subit des dégâts!',
            onShow: () => {
              impact(event.target, event.damage)
              void ports.presentation.animateHp(event.target, -event.damage)
            },
          })
        }
        if (event.critical) entries.push('Coup critique!')
        if (event.typeMultiplier === 0) entries.push("Ça n'affecte pas la cible…")
        else if (event.typeMultiplier > 10) entries.push("C'est super efficace!")
        else if (event.typeMultiplier < 10) entries.push("Ce n'est pas très efficace…")
      }
      else if (event.kind === 'faint') {
        entries.push({
          text: `${event.pokemonName} est K.O.!`,
          onShow: () => {
            const sprite = ports.scene.element(event.target).sprite
            ports.presentation.trackAnimation(playBattlePokemonFaint({
              sprite,
              defeated: event.defeated,
              current: event.defeated,
            }))
            if (eventIndex === victoryFaintIndex) {
              const playbackContext = ports.readContext()
              startHgssBattleVictoryMusic(
                playbackContext.audio,
                battle.kind === 'wild' ? 'wild' : 'trainer',
                resources.trainerCatalog[playbackContext.opponentTrainerIds[0] ?? -1]?.trainerClass,
              )
            }
          },
        })
        if (event.target.side === 'opponent' && !context.suppressProgression) {
          appendFaintProgression(entries, event, battle, context, resources)
        }
        clearDoubleBattleExperienceParticipation(battle, event.target, event.defeated)
      }
      else if (event.kind === 'sendOut') entries.push({
        text: `En avant, ${event.pokemonName}!`,
        onShow: () => {
          ports.scene.renderPosition(event.target, event.pokemon, event.types, event.stages, true)
          if (event.target.side === 'opponent') ports.markSeen(event.pokemon)
          const visual = ports.scene.element(event.target)
          ports.presentation.playSendOut(event.target, event.pokemon, visual.sprite, visual.hud)
        },
      })
      else if (event.kind === 'replacementRequest') entries.push({
        text: 'Choisissez un Pokémon.',
        onShow: () => ports.scene.showReplacement(event.target, event.reserveIndexes),
      })
      else if (event.kind === 'item') entries.push({
        text: event.applied ? formatHgssRomMessage(
          resources.battleMessages[857] ?? '{103 0,0} utilise {108 1,0}!',
          [event.source === 'trainer' ? event.trainerName ?? 'Le Dresseur' : context.player.name, event.itemName],
        ) : event.reason ?? 'Mais cela échoue!',
        onShow: () => {
          if (event.applied) ports.presentation.playCondition(event.actor, 'bagItem')
        },
      })
      else if (event.kind === 'cannotAct') entries.push({
        text: `${event.pokemonName} ne peut pas attaquer!`,
        onShow: () => playResolvedCondition(event.actor, event),
      })
      else if (event.kind === 'confusion') entries.push({
        text: `${event.pokemonName} est ${event.state === 'ended' ? 'sorti de sa confusion' : 'confus'}!`,
        onShow: () => playResolvedCondition(event.target, event),
      })
      else if (event.kind === 'selfDamage') entries.push({
        text: `${event.pokemonName} se blesse dans sa confusion!`,
        onShow: () => {
          impact(event.target, event.damage)
          void ports.presentation.animateHp(event.target, -event.damage)
        },
      })
      else if (event.kind === 'residual') entries.push({
        text: `${event.pokemonName} souffre de son statut!`,
        onShow: () => {
          impact(event.target, event.damage)
          playResolvedCondition(event.target, event)
          void ports.presentation.animateHp(event.target, -event.damage)
        },
      })
      else if (event.kind === 'recoil') entries.push({
        text: `${event.pokemonName} est blessé par le contrecoup!`,
        onShow: () => {
          impact(event.target, event.damage)
          void ports.presentation.animateHp(event.target, -event.damage)
        },
      })
      else if (event.kind === 'multiHit') entries.push(`${event.hits} fois!`)
      else if (event.kind === 'heal') entries.push({
        text: event.amount > 0
          ? `${event.pokemonName} récupère ${event.amount} PV!`
          : `${event.pokemonName} a déjà tous ses PV!`,
        onShow: () => {
          playResolvedCondition(event.target, event)
          void ports.presentation.animateHp(event.target, event.amount)
        },
      })
      else if (event.kind === 'statusCured') entries.push({
        text: event.applied
          ? `${event.pokemonName} n’a plus de problème de statut!`
          : `Cela n’a aucun effet sur ${event.pokemonName}.`,
        onShow: () => {
          if (event.applied) syncBattleHudPrimaryStatus(ports.scene.element(event.target).hud)
        },
      })
      else if (event.kind === 'statsReset') entries.push({
        text: 'Tous les changements de stats sont annulés!',
        onShow: () => {
          const neutral = {
            attack: 0,
            defense: 0,
            speed: 0,
            specialAttack: 0,
            specialDefense: 0,
            accuracy: 0,
            evasion: 0,
          }
          for (const position of getDoubleBattleOccupiedPositions(battle)) {
            syncBattleStageSummary(ports.scene.element(position).hud, neutral)
          }
        },
      })
      else if (event.kind === 'noEffect') entries.push(resources.battleMessages[777] ?? 'Mais cela échoue!')
      else if (event.kind === 'status') entries.push({
        text: event.applied
          ? `${event.pokemonName} subit un changement de statut!`
          : `Cela n’a aucun effet sur ${event.pokemonName}.`,
        onShow: () => {
          if (event.applied) syncBattleHudPrimaryStatus(ports.scene.element(event.target).hud, event.status)
          playResolvedCondition(event.target, event)
        },
      })
      else if (event.kind === 'stat') entries.push({
        text: event.applied
          ? `Les stats de ${event.pokemonName} changent!`
          : `Les stats de ${event.pokemonName} ne peuvent plus changer!`,
        onShow: () => {
          if (event.applied) applyBattleStagePresentation(ports.scene.element(event.target).hud, event.stat, event.change)
          playResolvedCondition(event.target, event)
        },
      })
      else if (event.kind === 'abilityReveal') {
        const abilityName = resources.pokemonCatalog.abilityNames?.[event.abilityId] ?? `Talent ${event.abilityId}`
        const values = event.abilityId === 107
          ? [abilityName, event.pokemonName]
          : event.abilityId === 108
            ? [event.pokemonName, abilityName, resources.pokemonCatalog.moveNames[event.moveId ?? 0] ?? '']
            : [event.pokemonName, resources.itemCatalog.items[event.itemId ?? 0]?.name ?? '']
        entries.push(formatHgssRomMessage(
          resources.battleMessages[event.abilityId === 107 ? 1106 : event.abilityId === 108 ? 1109 : 1118]
            ?? `${event.pokemonName} active ${abilityName}!`,
          values,
        ))
      }
      else if (event.kind === 'formChange') entries.push({
        text: formatHgssRomMessage(
          resources.battleMessages[721] ?? `${ports.getPokemonName(event.pokemon)} se transforme!`,
          [ports.getPokemonName(event.pokemon)],
        ),
        onShow: () => {
          ports.scene.renderPosition(event.target, event.pokemon, event.types, event.stages)
          ports.presentation.trackAnimation(playBattlePokemonEntrance({ sprite: ports.scene.element(event.target).sprite }))
        },
      })
      else if (event.kind === 'condition') entries.push({
        text: resolveBattleConditionMessage(event.condition, event.applied, resources.battleMessages[777]),
        onShow: () => {
          const animation = isHeldItemBattleCondition(event.condition)
            ? 'heldItem'
            : resolveHgssBattleEventPresentationAnimation(event)
          if (animation) ports.presentation.playCondition(event.target, animation)
        },
      })
      else if (event.kind === 'screen') entries.push(`${event.screen} protège votre équipe!`)
      else if (event.kind === 'weather') entries.push({
        text: `La météo devient ${event.weather}.`,
        onShow: () => { ports.elements.screen.dataset.weather = event.weather },
      })
      else if (event.kind === 'weatherDamage') entries.push({
        text: `${event.pokemonName} souffre de la météo!`,
        onShow: () => {
          impact(event.target, event.damage)
          void ports.presentation.animateHp(event.target, -event.damage)
        },
      })
      else if (event.kind === 'result') {
        entries.push(event.result === 'won' ? 'Victoire!' : 'Vous avez perdu…')
        const moneyMessage = ports.progression.settleMoney(
          event.result,
          battle.kind === 'double' && context.opponentTrainerIds.length === 1,
        )
        if (moneyMessage) entries.push(moneyMessage)
        entries.push(...ports.progression.deferred.drain())
      }
    }

    if (showImmediately) {
      ports.messages.replace(entries)
      ports.messages.showNext()
    } else {
      ports.messages.append(entries)
    }
  }

  function playResolvedCondition(
    position: DoubleBattlePosition,
    event: Parameters<typeof resolveHgssBattleEventPresentationAnimation>[0],
  ): void {
    const animation = resolveHgssBattleEventPresentationAnimation(event)
    if (animation) ports.presentation.playCondition(position, animation)
  }

  function appendFaintProgression(
    entries: BattleProgressionMessageEntry[],
    event: Extract<DoubleBattleEvent, { kind: 'faint' }>,
    battle: DoubleBattleSession,
    context: BrowserDoubleBattleEventContext,
    resources: RomInventory,
  ): void {
    const playerOwner = battle.teams.player.find((participant) => participant.controlled)
    const recipients = playerOwner ? resolveFieldBattleExperienceRecipients({
      party: playerOwner.party,
      participantPartyIndexes: new Set(getDoubleBattleExperienceParticipantIndexes(
        battle,
        event.target,
        event.defeated,
        playerOwner.ownerId,
      )),
      player: context.player,
      nativeLanguage: context.nativeLanguage,
      currentLocationId: context.currentLocationId,
      readHeldItem: (pokemon) => ({
        effect: resources.itemCatalog.items[pokemon.heldItemId]?.holdEffect ?? 0,
        parameter: resources.itemCatalog.items[pokemon.heldItemId]?.holdEffectParameter ?? 0,
      }),
    }) : []

    for (const { partyIndex, pokemon, experienceDivisor, modifiers } of recipients) {
      const before = cloneCanonicalPokemon(pokemon)
      const source = { kind: 'double', ownerId: playerOwner!.ownerId, partySlot: partyIndex } as const
      const renderRecipient = (presented = pokemon) => {
        battle.teams.player.forEach((_participant, participantSlot) => {
          const position = { side: 'player', slot: participantSlot as 0 | 1 } as const
          const visual = ports.scene.element(position)
          if (isBattlePokemonSpriteBoundTo(visual.sprite, pokemon)) {
            syncBattleProgressionHud(visual.hud, presented, resources.pokemonCatalog)
          }
        })
      }
      const progression = ports.progression.apply(
        pokemon,
        event.defeated,
        resources.pokemonCatalog,
        battle.kind !== 'wild',
        experienceDivisor,
        modifiers,
      )
      if (progression.experienceGained === 0) continue
      entries.push({
        text: formatHgssRomMessage(
          resources.battleMessages[1] ?? '{101 0,0} a gagné\n{136 1,0} points Exp.!',
          [ports.getPokemonName(pokemon), String(progression.experienceGained)],
        ),
        onShow: () => { renderRecipient(progression.levels.length > 0 ? before : pokemon) },
      })
      for (const level of progression.levels) {
        entries.push({
          text: `${ports.getPokemonName(pokemon)} monte au niveau ${level.level}!`,
          onShow: () => {
            renderRecipient({
              ...pokemon,
              level: level.level,
              stats: level.statsAfter,
              currentHp: level.currentHpAfter,
              experience: before.experience,
            })
            ports.presentation.showLevelUpCard(pokemon, level)
          },
        })
        ports.progression.messagePresenter.enqueueMoveLearning(
          ports.progression.deferred,
          pokemon,
          source,
          level.learnedMoveIds,
          level.skippedMoveIds,
        )
      }
      if (progression.levels.length > 0) {
        ports.progression.deferred.enqueueEvolution(
          createBattleProgressionPokemonKey(pokemon, source),
          ports.progression.createEvolutionEntry(pokemon, source),
        )
      }
    }
  }

  return Object.freeze({ queue })
}
