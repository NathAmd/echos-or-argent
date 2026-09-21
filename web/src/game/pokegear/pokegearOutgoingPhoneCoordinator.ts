import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { HgssOutgoingPhoneChoiceValue } from '../../rom/phone/outgoingPhoneCalls'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssSessionRng } from '../pokemon/hgssSessionRng'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import type { ChoicePopupRequest } from '../ui/choicePopupController'
import { applyHgssOutgoingPhoneEffects, continueHgssOutgoingPhoneSession, createHgssOutgoingPhoneSession, formatHgssOutgoingPhoneMessages, getHgssPhoneChoiceLabels, type HgssOutgoingPhoneSession } from './outgoingPhoneSession'

type PhoneSnapshot = { state: FieldScriptState, inventory: RomInventory, map: OpeningMapPreview, rng: HgssSessionRng }

export type PokegearOutgoingPhoneCoordinator = {
  start: (contactId: number) => boolean
  isActive: () => boolean
  cancel: () => void
}

export function createPokegearOutgoingPhoneCoordinator(options: {
  getSnapshot: () => PhoneSnapshot | undefined
  present: (speaker: string, messages: readonly string[], onComplete: () => void) => void
  choose: (request: ChoicePopupRequest<HgssOutgoingPhoneChoiceValue>) => void
  finish: () => void
  persist: () => void
  levelPolicy?: PokemonLevelPolicy
}): PokegearOutgoingPhoneCoordinator {
  let active: HgssOutgoingPhoneSession | undefined

  const present = (session: HgssOutgoingPhoneSession, snapshot: PhoneSnapshot): void => {
    active = session
    applyHgssOutgoingPhoneEffects(session.call.effects, snapshot.state)
    if (session.call.effects.length > 0) options.persist()
    const messages = formatHgssOutgoingPhoneMessages(session, snapshot.state, snapshot.inventory, snapshot.map)
    const caller = snapshot.inventory.phoneContactNames[session.call.callerId] ?? ''
    options.present(caller, messages, () => {
      const choice = session.call.choice
      if (!choice) {
        active = undefined
        options.finish()
        return
      }
      const labels = getHgssPhoneChoiceLabels(session, snapshot.inventory)
      options.choose({
        title: caller,
        message: messages.at(-1) ?? '',
        options: choice.options.map((option, index) => ({ value: option.value, label: labels[index] ?? '' })),
        initialIndex: choice.defaultIndex,
        cancelIndex: choice.options.length - 1,
        onSelect: (value) => {
          const continuation = continueHgssOutgoingPhoneSession(session, value)
          if (continuation) present(continuation, snapshot)
          else { active = undefined; options.finish() }
        },
      })
    })
  }

  return {
    start(contactId) {
      const snapshot = options.getSnapshot()
      if (!snapshot) return false
      const session = createHgssOutgoingPhoneSession(contactId, snapshot.state, snapshot.inventory, snapshot.map, snapshot.rng, options.levelPolicy)
      if (!session) return false
      present(session, snapshot)
      return true
    },
    isActive: () => Boolean(active),
    cancel() { active = undefined },
  }
}
