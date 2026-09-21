import type { GameDigitalAction, GameDigitalEvent } from '../gameInput'
import type { PlayerDirection } from '../ndsTypes'

export type Movement = { x: number, z: number, direction: PlayerDirection }

export const movementDirections: Record<string, Movement> = {
  ArrowUp: { x: 0, z: -1, direction: 'north' },
  w: { x: 0, z: -1, direction: 'north' },
  W: { x: 0, z: -1, direction: 'north' },
  GamepadUp: { x: 0, z: -1, direction: 'north' },
  ArrowDown: { x: 0, z: 1, direction: 'south' },
  s: { x: 0, z: 1, direction: 'south' },
  S: { x: 0, z: 1, direction: 'south' },
  GamepadDown: { x: 0, z: 1, direction: 'south' },
  ArrowLeft: { x: -1, z: 0, direction: 'west' },
  a: { x: -1, z: 0, direction: 'west' },
  A: { x: -1, z: 0, direction: 'west' },
  GamepadLeft: { x: -1, z: 0, direction: 'west' },
  ArrowRight: { x: 1, z: 0, direction: 'east' },
  d: { x: 1, z: 0, direction: 'east' },
  D: { x: 1, z: 0, direction: 'east' },
  GamepadRight: { x: 1, z: 0, direction: 'east' },
}

export const gamepadMovementKeys: Partial<Record<GameDigitalAction, string>> = {
  up: 'GamepadUp',
  down: 'GamepadDown',
  left: 'GamepadLeft',
  right: 'GamepadRight',
}

/**
 * Normalise la touche physique d'une direction avant le routage des couches UI.
 * Le relâchement peut ainsi être observé même lorsqu'une modale consomme ensuite
 * l'événement numérique.
 */
export function resolveMovementInputKey(
  event: Pick<GameDigitalEvent, 'action' | 'inputId'>,
): string | undefined {
  if (event.inputId && movementDirections[event.inputId]) return event.inputId
  return gamepadMovementKeys[event.action]
}

export type MovementInput = {
  remember: (key: string) => void
  release: (key: string) => void
  clear: () => void
  getActive: () => Movement | undefined
  isDirectionHeld: (direction: PlayerDirection) => boolean
}

/**
 * Met à jour les états physiques qui ne doivent jamais être avalés par une
 * couche modale. Le key retourné peut ensuite être routé vers le gameplay.
 */
export function observePhysicalMovementInput(
  event: Pick<GameDigitalEvent, 'action' | 'pressed' | 'inputId'>,
  input: Pick<MovementInput, 'release'>,
  setRunPressed: (pressed: boolean) => void,
): string | undefined {
  const movementKey = resolveMovementInputKey(event)
  if (!event.pressed && movementKey) input.release(movementKey)
  if (event.action === 'cancel') setRunPressed(event.pressed)
  return movementKey
}

export function createMovementInput(): MovementInput {
  const pressedKeys = new Set<string>()
  let keyHistory: string[] = []

  const remember = (key: string): void => {
    if (!movementDirections[key]) return
    pressedKeys.add(key)
    keyHistory = keyHistory.filter((candidate) => candidate !== key)
    keyHistory.push(key)
  }

  const release = (key: string): void => {
    pressedKeys.delete(key)
    keyHistory = keyHistory.filter((candidate) => candidate !== key)
  }

  const clear = (): void => {
    pressedKeys.clear()
    keyHistory = []
  }

  const getActive = (): Movement | undefined => {
    for (let index = keyHistory.length - 1; index >= 0; index -= 1) {
      const key = keyHistory[index]
      if (pressedKeys.has(key)) return movementDirections[key]
    }
    return undefined
  }

  const isDirectionHeld = (direction: PlayerDirection): boolean => [...pressedKeys].some((key) => (
    movementDirections[key]?.direction === direction
  ))

  return { remember, release, clear, getActive, isDirectionHeld }
}
