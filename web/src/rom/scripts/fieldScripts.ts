const SCRIPT_DEFINITION_END = 0xfd13

export type FieldScriptBank = {
  headerSize: number
  entryOffsets: number[]
}

export type MapInitCondition = {
  variable: number
  value: number
  scriptId: number
}

export type MapInitScriptEntry =
  | { type: 'onFrame'; conditionsOffset: number, conditions: MapInitCondition[] }
  | { type: 'onTransition' | 'onResume' | 'onLoad', scriptId: number }

export type MapInitPhase = 'transition' | 'resume' | 'load'

function requireRange(bytes: Uint8Array, offset: number, size: number, label: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.byteLength) {
    throw new Error(`${label} depasse les limites de la banque de scripts.`)
  }
}

export function decodeFieldScriptBank(bytes: Uint8Array): FieldScriptBank {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const relativeEntries: { fieldOffset: number, relativeOffset: number }[] = []
  let cursor = 0

  while (true) {
    requireRange(bytes, cursor, 2, 'La table ScrDef')
    if (view.getUint16(cursor, true) === SCRIPT_DEFINITION_END) {
      const headerSize = cursor + 2
      const entryOffsets = relativeEntries.map(({ fieldOffset, relativeOffset }, index) => {
        const target = fieldOffset + 4 + relativeOffset
        if (target < headerSize || target + 2 > bytes.byteLength) {
          throw new Error(`L’offset ScrDef ${index} cible une adresse hors de la banque.`)
        }
        return target
      })
      return { headerSize, entryOffsets }
    }

    requireRange(bytes, cursor, 4, 'Une entree ScrDef')
    relativeEntries.push({ fieldOffset: cursor, relativeOffset: view.getInt32(cursor, true) })
    cursor += 4
  }
}

function decodeFrameConditions(bytes: Uint8Array, offset: number): MapInitCondition[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const conditions: MapInitCondition[] = []
  let cursor = offset
  while (true) {
    requireRange(bytes, cursor, 2, 'La table de conditions d’initialisation')
    const variable = view.getUint16(cursor, true)
    if (variable === 0) return conditions
    requireRange(bytes, cursor, 6, 'Une condition d’initialisation')
    conditions.push({
      variable,
      value: view.getUint16(cursor + 2, true),
      scriptId: view.getUint16(cursor + 4, true),
    })
    cursor += 6
  }
}

export function decodeMapInitScripts(bytes: Uint8Array): MapInitScriptEntry[] {
  if (bytes.byteLength === 0) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries: MapInitScriptEntry[] = []
  let cursor = 0

  while (true) {
    requireRange(bytes, cursor, 1, 'La table des scripts d’initialisation')
    const type = bytes[cursor]
    if (type === 0) return entries
    requireRange(bytes, cursor, 5, 'Une entree de script d’initialisation')

    if (type === 1) {
      const relativeOffset = view.getInt32(cursor + 1, true)
      const conditionsOffset = cursor + 5 + relativeOffset
      requireRange(bytes, conditionsOffset, 2, 'La table de conditions d’initialisation')
      entries.push({
        type: 'onFrame',
        conditionsOffset,
        conditions: decodeFrameConditions(bytes, conditionsOffset),
      })
    } else if (type >= 2 && type <= 4) {
      const reserved = view.getUint16(cursor + 3, true)
      if (reserved !== 0) {
        throw new Error(`L’entree d’initialisation de type ${type} contient un champ reserve non nul.`)
      }
      entries.push({
        type: type === 2 ? 'onTransition' : type === 3 ? 'onResume' : 'onLoad',
        scriptId: view.getUint16(cursor + 1, true),
      })
    } else {
      throw new Error(`Type de script d’initialisation HGSS inconnu: ${type}.`)
    }
    cursor += 5
  }
}

export function resolveMapInitScript(entries: MapInitScriptEntry[], phase: MapInitPhase, readVariable: (variable: number) => number): number | undefined {
  void readVariable
  for (const entry of entries) {
    if (entry.type === 'onFrame') continue
    if (entry.type === `on${phase[0].toUpperCase()}${phase.slice(1)}`) return entry.scriptId
  }
  return undefined
}

export function resolveMapInitScripts(entries: MapInitScriptEntry[], phase: MapInitPhase): number[] {
  const phaseType = `on${phase[0].toUpperCase()}${phase.slice(1)}`
  return entries
    .filter((entry): entry is Extract<MapInitScriptEntry, { type: 'onTransition' | 'onResume' | 'onLoad' }> => entry.type === phaseType)
    .map((entry) => entry.scriptId)
}

export function resolveMapFrameScripts(entries: MapInitScriptEntry[], readVariable: (variable: number) => number): number[] {
  const scriptIds: number[] = []
  for (const entry of entries) {
    if (entry.type !== 'onFrame') continue
    const condition = entry.conditions.find((candidate) => readVariable(candidate.variable) === candidate.value)
    if (condition && !scriptIds.includes(condition.scriptId)) scriptIds.push(condition.scriptId)
  }
  return scriptIds
}