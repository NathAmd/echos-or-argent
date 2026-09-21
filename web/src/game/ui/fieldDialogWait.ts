export type FieldScriptWaitKind =
  | 'input'
  | 'movement'
  | 'followerMovement'
  | 'followerReaction'
  | 'timer'
  | 'music'
  | 'soundEffect'
  | 'fanfareStart'
  | 'fanfare'
  | 'cryStart'
  | 'cry'
  | 'doorAnimation'
  | 'mapPropAnimation'
  | 'apricornTree'
  | 'screenShake'
  | 'specialCutscene'
  | 'gymMechanism'
  | 'multiplayer'

export type AcknowledgedDialogWaitAction = 'advance' | 'dismiss' | 'ignore'

export function getAcknowledgedDialogWaitAction(wait: FieldScriptWaitKind): AcknowledgedDialogWaitAction {
  if (wait === 'timer' || wait === 'soundEffect' || wait === 'fanfare' || wait === 'cry') return 'advance'
  if (wait === 'movement' || wait === 'followerMovement' || wait === 'music' || wait === 'doorAnimation' || wait === 'mapPropAnimation' || wait === 'apricornTree' || wait === 'screenShake' || wait === 'specialCutscene' || wait === 'gymMechanism') return 'dismiss'
  return 'ignore'
}
