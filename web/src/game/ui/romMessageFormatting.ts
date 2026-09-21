const interpolatedHgssMessageCommands = new Set([
  '100',
  '101',
  '103',
  '106',
  '108',
  '10b',
  '10e',
  '132',
  '133',
  '136',
  '137',
])

/**
 * Resolves the variable controls used by HGSS UI and battle message banks.
 * Presentation-only controls (colors, waits and page ends) are removed without
 * consuming a value so every screen follows the same interpolation contract.
 */
export function interpolateHgssRomMessage(template: string, values: readonly string[]): string {
  let valueIndex = 0
  const interpolatedValues = new Map<string, string>()
  return template
    .replace(/\{([0-9a-f]+)([^}]*)\}/gi, (_control, command: string, operands: string) => {
      if (!interpolatedHgssMessageCommands.has(command.toLowerCase())) return _control
      // The first operand is the native message-variable slot. A template may
      // print the same slot more than once (notably the field CT/CS prompt).
      // Reusing that value is essential: consuming another positional value
      // made the repeated Pokémon and move names swap or disappear.
      const slot = operands.match(/\d+/)?.[0] ?? ''
      const key = `${command.toLowerCase()}:${slot}`
      const previous = interpolatedValues.get(key)
      if (previous !== undefined) return previous
      const value = values[valueIndex] ?? ''
      valueIndex += 1
      interpolatedValues.set(key, value)
      return value
    })
}

export function formatHgssRomMessage(template: string, values: readonly string[]): string {
  return interpolateHgssRomMessage(template, values)
    .replace(/\{[^}]*\}/g, '')
    .replace(/[\f\r]/g, '\n')
}
