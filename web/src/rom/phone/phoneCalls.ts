export type HgssPendingPhoneCall = {
  callerId: number
  /** `isScriptedCall` dans l'application Pokématos native. */
  parameter1: number
  /** Index de scénario prédéfini pour les appels lancés par une map. */
  parameter2: number
}

export type HgssResolvedPhoneMessage = {
  callerId: number
  messageId: number
  phoneScriptId: number
  /** Effets appliqués par le gestionnaire natif avant l'affichage du message. */
  initialEffects?: readonly HgssScriptedPhoneFlagEffect[]
  /** Continuation interactive propre à certains appels lancés par une map. */
  choice?: HgssScriptedPhoneChoice
}

export const HGSS_DAYCARE_TRIGGER_EGG_CALL_FLAG_ID = 0x992 as const
export const HGSS_TALKED_TO_MOM_AFTER_NAMING_RIVAL_FLAG_ID = 0xa7 as const
export const HGSS_MOM_SAVINGS_FLAG_ID = 0x986 as const

export type HgssScriptedPhoneFlagEffect = Readonly<{
  kind: 'flag'
  flagId: number
  enabled: boolean
}>

export type HgssScriptedPhoneChoiceValue = 'yes' | 'no'

export type HgssScriptedPhoneChoice = Readonly<{
  kind: 'mom-saving'
  options: readonly Readonly<{
    value: HgssScriptedPhoneChoiceValue
    labelMessageId: number
    continuationMessageId: number
    effects: readonly HgssScriptedPhoneFlagEffect[]
  }>[]
  defaultIndex: number
  cancelIndex: number
}>

export type HgssScriptedPhoneMessageContext = {
  /** `Pokedex_CountNationalDexOwned`, requis par l'appel entrant de Chen. */
  nationalDexOwnedCount?: number
  /** SaveVarsFlags, requis pour distinguer les deux appels entrants de la Pension. */
  eventFlags?: ReadonlySet<number>
}

// Table native `sPhoneCallData_ProfElm_MapScripts`. Les scripts de map ne
// pointent pas directement vers un message : ils choisissent d'abord un
// scénario de l'application téléphone, qui choisit ensuite le texte selon le
// genre du joueur.
const profElmMapPhoneScripts = [2, 3, 4, 5, 6] as const

// Entrées correspondantes de `gPhoneCallScriptDef`, dans la banque ROM 716.
const profElmPhoneScriptMessages: Readonly<Record<number, readonly [number, number]>> = {
  2: [33, 34],
  3: [35, 36],
  4: [37, 38],
  5: [39, 40],
  6: [41, 42],
}

// `PhoneCall_GetScriptId_Baoba`: les appels scénarisés de carte utilisent le
// script 141, puis la banque 667 choisit 2/3 selon le genre du joueur.
const baobaMapPhoneScriptId = 141 as const
const baobaPhoneScriptMessages: Readonly<Record<number, readonly [number, number]>> = {
  141: [2, 3],
  142: [4, 5],
  143: [6, 7],
  144: [8, 9],
  145: [10, 11],
  146: [12, 13],
}

// `GearPhoneCall_Mother`, appel de Route 30 : le gestionnaire saute
// l'introduction géographique, affiche 22, puis le menu natif 2 dont les
// libellés sont les messages 8/9 de la banque 271. B équivaut à la seconde
// réponse, comme `TouchscreenListMenu_HandleInput` renvoie LIST_CANCEL (-2).
const scriptedMotherSavingsChoice: HgssScriptedPhoneChoice = {
  kind: 'mom-saving',
  options: [
    {
      value: 'yes',
      labelMessageId: 8,
      continuationMessageId: 25,
      effects: [{ kind: 'flag', flagId: HGSS_MOM_SAVINGS_FLAG_ID, enabled: true }],
    },
    {
      value: 'no',
      labelMessageId: 9,
      continuationMessageId: 26,
      effects: [{ kind: 'flag', flagId: HGSS_MOM_SAVINGS_FLAG_ID, enabled: false }],
    },
  ],
  defaultIndex: 0,
  cancelIndex: 1,
}

/**
 * Entrées directes de `gPhoneCallScriptDef` utilisées par `ov02_02253C84`.
 * Les nombres restent des indices dans la banque propre à chaque contact.
 */
const persistentDirectPhoneScriptMessages: Readonly<Record<number, {
  callerId: number
  messageIds: readonly [number, number]
}>> = {
  7: { callerId: 1, messageIds: [43, 44] },
  13: { callerId: 1, messageIds: [13, 14] },
  27: { callerId: 0, messageIds: [29, 29] },
  85: { callerId: 15, messageIds: [3, 3] },
  93: { callerId: 9, messageIds: [10, 11] },
}

function createResolvedMessage(
  callerId: number,
  phoneScriptId: number,
  messageIds: readonly [number, number],
  gender: 'male' | 'female',
): HgssResolvedPhoneMessage {
  return {
    callerId,
    phoneScriptId,
    messageId: messageIds[gender === 'male' ? 0 : 1],
  }
}

function resolvePersistentIncomingPhoneMessage(
  call: HgssPendingPhoneCall,
  gender: 'male' | 'female',
  context: HgssScriptedPhoneMessageContext,
): HgssResolvedPhoneMessage | undefined {
  const direct = persistentDirectPhoneScriptMessages[call.parameter2]
  if (direct?.callerId === call.callerId) {
    return createResolvedMessage(call.callerId, call.parameter2, direct.messageIds, gender)
  }

  // `PhoneCall_GetScriptId_ProfOak`: le trigger stocke SCRIPT_NONE, puis le
  // téléphone choisit l'un des scripts 69..77 depuis le Pokédex au décrochage.
  if (call.callerId === 2 && call.parameter2 === 0) {
    const owned = context.nationalDexOwnedCount
    if (owned === undefined) return undefined
    if (!Number.isInteger(owned) || owned < 0) {
      throw new Error(`Le nombre de Pokémon du Pokédex national ${owned} est invalide.`)
    }
    const milestone = Math.max(1, Math.min(9, Math.floor(owned / 50)))
    const phoneScriptId = 68 + milestone
    return createResolvedMessage(call.callerId, phoneScriptId, [2 + milestone, 2 + milestone], gender)
  }

  // `PhoneCall_GetScriptId_DayCareMan`: le premier avis pose le flag 0x992
  // via le script 95; les avis suivants emploient le script 96.
  if (call.callerId === 6 && call.parameter2 === 0) {
    if (!context.eventFlags) return undefined
    const eggCallWasAlreadyTriggered = context.eventFlags.has(HGSS_DAYCARE_TRIGGER_EGG_CALL_FLAG_ID)
    const phoneScriptId = eggCallWasAlreadyTriggered ? 96 : 95
    const messageId = eggCallWasAlreadyTriggered ? 13 : 12
    return createResolvedMessage(call.callerId, phoneScriptId, [messageId, messageId], gender)
  }
  return undefined
}

/**
 * Résout les appels narratifs d'Orme lancés par `SetPhoneCall`/`RunPhoneCall`.
 * Le contenu reste lu dans la banque de messages de la ROM ; cette fonction
 * ne reproduit que les deux tables de routage de l'application native.
 */
export function resolveHgssScriptedPhoneMessage(
  call: HgssPendingPhoneCall,
  gender: 'male' | 'female',
  context: HgssScriptedPhoneMessageContext = {},
): HgssResolvedPhoneMessage | undefined {
  if (call.parameter1 === 3) {
    const persistent = resolvePersistentIncomingPhoneMessage(call, gender, context)
    if (persistent) return persistent
  }
  if (call.parameter1 === 3 && call.callerId === 24) {
    const messageIds = baobaPhoneScriptMessages[call.parameter2]
    if (!messageIds) return undefined
    return createResolvedMessage(call.callerId, call.parameter2, messageIds, gender)
  }
  if (call.parameter1 !== 2) return undefined
  if (call.callerId === 0 && call.parameter2 === 0) {
    return {
      callerId: call.callerId,
      phoneScriptId: 0,
      messageId: 22,
      initialEffects: [{
        kind: 'flag',
        flagId: HGSS_TALKED_TO_MOM_AFTER_NAMING_RIVAL_FLAG_ID,
        enabled: true,
      }],
      choice: scriptedMotherSavingsChoice,
    }
  }
  if (call.callerId === 1) {
    const phoneScriptId = profElmMapPhoneScripts[call.parameter2]
    if (phoneScriptId === undefined) return undefined
    const messageIds = profElmPhoneScriptMessages[phoneScriptId]
    if (!messageIds) return undefined
    return createResolvedMessage(call.callerId, phoneScriptId, messageIds, gender)
  }
  if (call.callerId === 24 && call.parameter2 === 0) {
    const messageIds = baobaPhoneScriptMessages[baobaMapPhoneScriptId]
    if (!messageIds) return undefined
    return createResolvedMessage(call.callerId, baobaMapPhoneScriptId, messageIds, gender)
  }
  // `PhoneCall_GetScriptId_ProfOak` retourne explicitement le script 82 pour
  // cet appel de map ; `gPhoneCallScriptDef[82]` pointe vers le message 12.
  if (call.callerId === 2 && call.parameter2 === 0) {
    return createResolvedMessage(call.callerId, 82, [12, 12], gender)
  }
  return undefined
}
