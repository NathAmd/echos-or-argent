export type HgssFieldPhoneCallInputDisposition = 'pass' | 'advance' | 'block'

/**
 * Donne au dialogue téléphonique la propriété exclusive des commandes terrain.
 * Un appel entrant n'a pas forcément de FieldScriptRunner pour bloquer le
 * déplacement : cette frontière couvre donc aussi les appels forcés de Baoba.
 */
export function resolveHgssFieldPhoneCallInput(
  active: boolean,
  pressed: boolean,
  action: string,
  dialogueVisible: boolean,
): HgssFieldPhoneCallInputDisposition {
  if (!active) return 'pass'
  if (pressed && dialogueVisible && (action === 'confirm' || action === 'cancel')) return 'advance'
  return 'block'
}
