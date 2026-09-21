export type OnlineRuntimeAccessToken = Readonly<{
  read: () => string | undefined
  replace: (value: string) => void
  clear: () => void
}>

const maximumAccessTokenBytes = 512

function validateAccessToken(value: string): string {
  if (
    value.length === 0
    || /\s/.test(value)
    || new TextEncoder().encode(value).byteLength > maximumAccessTokenBytes
  ) {
    throw new TypeError('La session du compte est invalide.')
  }
  return value
}

/**
 * Capsule volontairement volatile. Elle ne connaît ni Storage, ni cookie, ni
 * URL : perdre le contexte JavaScript détruit donc l'unique référence gardée
 * par le client officiel.
 */
export function createOnlineRuntimeAccessToken(): OnlineRuntimeAccessToken {
  let accessToken: string | undefined
  return Object.freeze({
    read: () => accessToken,
    replace(value) { accessToken = validateAccessToken(value) },
    clear() { accessToken = undefined },
  })
}
