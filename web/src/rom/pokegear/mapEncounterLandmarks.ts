const maxHgssSpeciesId = 493
const maxPokemonLevel = 100
const maxStatesPerEntry = 4_096
const maxCallDepth = 32

const opcodeOperandBytes = new Map<number, number>([
  [0, 0], // Noop
  [1, 0], // Dummy
  [2, 0], // End
  [17, 4], // CompareVarToValue
  [18, 4], // CompareVarToVar
  [21, 0], // RestartCurrentScript (terminal in the field runner)
  [22, 4], // GoTo
  [26, 4], // Call
  [27, 0], // Return
  [28, 5], // GoToIf
  [29, 5], // CallIf
  [30, 2], // SetFlag
  [31, 2], // ClearFlag
  [32, 2], // CheckFlag
  [33, 2], // SetFlagVar
  [34, 2], // ClearFlagVar
  [35, 4], // CheckFlagVar
  [39, 4], // AddVar
  [40, 4], // SubVar
  [41, 4], // SetVar
  [42, 4], // CopyVar
  [43, 4], // SetOrCopyVar
  [44, 1], // NonNPCMsg
  [45, 1], // NPCMsg
  [49, 0], // WaitABPress
  [50, 0], // WaitButton
  [51, 0], // WaitButtonOrDpad
  [52, 0], // OpenMsg
  [53, 0], // CloseMsg
  [54, 0], // HoldMsg
  [73, 2], // PlaySE
  [74, 2], // StopSE
  [75, 2], // WaitSE
  [76, 4], // PlayCry
  [77, 0], // WaitCry
  [78, 2], // PlayFanfare
  [79, 0], // WaitFanfare
  [80, 2], // PlayBGM
  [81, 2], // StopBGM
  [82, 0], // ResetBGM
  [84, 4], // FadeOutBGM
  [85, 2], // FadeInBGM
  [94, 6], // ApplyMovement
  [95, 0], // WaitMovement
  [96, 0], // LockAll
  [97, 0], // ReleaseAll
  [98, 2], // Lock
  [99, 2], // Release
  [100, 2], // ShowPerson
  [101, 2], // HidePerson
  [104, 0], // FacePlayer
  [128, 6], // HasItem
  [190, 1], // BufferPlayersName
  [219, 0], // WhiteOut
  [220, 2], // CheckBattleWon
  [221, 3], // StaticWildWonOrCaughtCheck
  [249, 4], // RocketTrapBattle
  [284, 0], // RestoreOverworld
  [386, 2], // GetPlayerFacing
  [495, 2], // GetGameVersion
  [523, 10], // Object movement task used by static encounters
  [546, 3], // Story-state check used by the roaming Lati encounter
  [588, 2], // LatiCaughtCheck
  [589, 5], // WildBattle
  [609, 0], // Rocket trap setup
  [683, 2], // GetStaticEncounterOutcome
  [708, 2], // Rocket trap effect
  [746, 0], // TouchscreenMenuHide
  [747, 0], // TouchscreenMenuShow
  [748, 2], // GetMenuChoice
  [779, 4], // RadioMusicIsPlaying
  [796, 0], // Field UI synchronization
])

export type MapEncounterObjectEvent = {
  readonly id?: number
  readonly scriptId: number
  readonly eventFlag: number
}

/** Structural subset of OpeningMapPreview; no runtime/UI dependency is required. */
export type MapEncounterLandmarkSource = {
  readonly id: number
  readonly fieldScripts: {
    readonly bank: number
    readonly bytes: Uint8Array
    readonly headerSize?: number
    readonly entryOffsets: readonly number[]
    readonly baseScriptId?: number
  }
  readonly events?: {
    readonly objects: readonly MapEncounterObjectEvent[]
  }
}

export type MapEncounterFlagCondition = {
  readonly flagId: number
  readonly state: 'set' | 'clear'
}

export type MapEncounterLandmark = {
  readonly mapId: number
  readonly speciesId: number
  /** Omitted when the ROM command uses a value that is not invariant. */
  readonly level?: number
  /** Raw final byte of WildBattle; RocketTrapBattle always exposes zero. */
  readonly battleParameter: number
  readonly command: 'rocketTrapBattle' | 'wildBattle'
  /**
   * Preuve positive issue des données personnelles de la ROM : commande
   * WildBattle et groupe d'œuf « Inconnu ». L'absence de cette propriété est
   * volontairement non concluante et ne doit jamais être transformée en liste
   * manuelle d'espèces.
   */
  readonly isRomLegendary?: true
  readonly conditions: readonly MapEncounterFlagCondition[]
  /** Exact ObjectEvent flag when one unique ROM object owns the script. */
  readonly disappearanceFlagId?: number
  readonly provenance: {
    readonly bank: number
    readonly scriptId: number
    readonly entryOffset: number
    readonly commandOffset: number
    readonly opcode: 249 | 589
  }
}

export type MapEncounterLandmarkBuildOptions = {
  readonly personalData?: readonly ({
    readonly eggGroups: readonly [number, number]
  } | undefined)[]
}

export type MapEncounterLandmarkDiagnosticReason =
  | 'invalid-entry-offset'
  | 'truncated-command'
  | 'unsupported-opcode'
  | 'invalid-branch-condition'
  | 'invalid-control-flow-target'
  | 'call-depth-limit'
  | 'state-limit'
  | 'unresolved-species'

export type MapEncounterLandmarkDiagnostic = {
  readonly mapId: number
  readonly bank: number
  readonly scriptId: number
  readonly entryOffset: number
  readonly offset: number
  readonly reason: MapEncounterLandmarkDiagnosticReason
  readonly opcode?: number
}

export type MapEncounterLandmarkIndex = {
  readonly landmarks: readonly MapEncounterLandmark[]
  readonly byMapId: ReadonlyMap<number, readonly MapEncounterLandmark[]>
  readonly diagnostics: readonly MapEncounterLandmarkDiagnostic[]
}

type KnownComparison = { readonly kind: 'known', readonly value: -1 | 0 | 1 }
type FlagComparison = { readonly kind: 'flag', readonly flagId: number }
type UnknownComparison = { readonly kind: 'unknown' }
type Comparison = KnownComparison | FlagComparison | UnknownComparison

type AnalysisState = {
  cursor: number
  variables: Map<number, number>
  flags: Map<number, boolean>
  conditions: Map<number, boolean>
  comparison: Comparison
  returnOffsets: number[]
}

type EncounterObservation = {
  commandOffset: number
  opcode: 249 | 589
  speciesId?: number
  speciesIsLiteral: boolean
  level?: number
  battleParameter: number
  conditions: Map<number, boolean>
}

type EntryAnalysis = {
  observations: EncounterObservation[]
  diagnostics: MapEncounterLandmarkDiagnostic[]
  stoppedBeforeBattle: boolean
}

type BranchPossibility = {
  takeBranch: boolean
  flagState?: boolean
}

function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value)
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readInt32(view: DataView, offset: number): number {
  return view.getInt32(offset, true)
}

function compare(left: number, right: number): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0
}

function matchesCondition(value: -1 | 0 | 1, condition: number): boolean | undefined {
  return [value < 0, value === 0, value > 0, value <= 0, value >= 0, value !== 0][condition]
}

function cloneState(state: AnalysisState, cursor: number): AnalysisState {
  return {
    cursor,
    variables: new Map(state.variables),
    flags: new Map(state.flags),
    conditions: new Map(state.conditions),
    comparison: state.comparison,
    returnOffsets: [...state.returnOffsets],
  }
}

function sortedMapSignature(values: ReadonlyMap<number, number | boolean>): string {
  return [...values]
    .sort(([left], [right]) => left - right)
    .map(([key, value]) => `${key}:${Number(value)}`)
    .join(',')
}

function stateSignature(state: AnalysisState): string {
  const comparison = state.comparison.kind === 'known'
    ? `k${state.comparison.value}`
    : state.comparison.kind === 'flag'
      ? `f${state.comparison.flagId}`
      : 'u'
  return [
    state.cursor,
    state.returnOffsets.join(','),
    sortedMapSignature(state.variables),
    sortedMapSignature(state.flags),
    sortedMapSignature(state.conditions),
    comparison,
  ].join('|')
}

function resolveOperand(encoded: number, variables: ReadonlyMap<number, number>): number | undefined {
  return encoded >= 0x4000 ? variables.get(encoded) : encoded
}

function branchPossibilities(comparison: Comparison, condition: number): BranchPossibility[] | undefined {
  if (condition < 0 || condition > 5) return undefined
  if (comparison.kind === 'known') {
    return [{ takeBranch: matchesCondition(comparison.value, condition)! }]
  }
  if (comparison.kind === 'unknown') {
    const possible = new Set([-1, 0, 1].map((value) => matchesCondition(value as -1 | 0 | 1, condition)!))
    return [...possible].map((takeBranch) => ({ takeBranch }))
  }

  const byBranch = new Map<boolean, boolean[]>()
  for (const [flagState, value] of [[false, -1], [true, 0]] as const) {
    const takeBranch = matchesCondition(value, condition)!
    const states = byBranch.get(takeBranch) ?? []
    states.push(flagState)
    byBranch.set(takeBranch, states)
  }
  return [...byBranch].map(([takeBranch, states]) => ({
    takeBranch,
    ...(states.length === 1 ? { flagState: states[0] } : {}),
  }))
}

function applyFlagConstraint(state: AnalysisState, flagId: number, flagState: boolean): boolean {
  const existing = state.conditions.get(flagId)
  if (existing !== undefined && existing !== flagState) return false
  state.conditions.set(flagId, flagState)
  state.flags.set(flagId, flagState)
  return true
}

function uniqueObjectFlag(source: MapEncounterLandmarkSource, scriptId: number): number | undefined {
  const candidates = new Set(
    source.events?.objects
      .filter((object) => object.scriptId === scriptId && object.eventFlag > 0 && object.eventFlag <= 0xffff)
      .map((object) => object.eventFlag) ?? [],
  )
  return candidates.size === 1 ? candidates.values().next().value : undefined
}

function commonConditions(observations: readonly EncounterObservation[]): MapEncounterFlagCondition[] {
  const first = observations[0]
  if (!first) return []
  return [...first.conditions]
    .filter(([flagId, state]) => observations.every((observation) => observation.conditions.get(flagId) === state))
    .sort(([left], [right]) => left - right)
    .map(([flagId, state]) => ({ flagId, state: state ? 'set' : 'clear' }))
}

function analyzeEntry(
  source: MapEncounterLandmarkSource,
  scriptId: number,
  entryOffset: number,
): EntryAnalysis {
  const { bytes } = source.fieldScripts
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const codeStart = source.fieldScripts.headerSize
    ?? Math.min(...source.fieldScripts.entryOffsets.filter((offset) => isSafeInteger(offset) && offset >= 0))
  const diagnostics: MapEncounterLandmarkDiagnostic[] = []
  const diagnosticKeys = new Set<string>()
  const observations: EncounterObservation[] = []
  let stoppedBeforeBattle = false

  const addDiagnostic = (
    reason: MapEncounterLandmarkDiagnosticReason,
    offset: number,
    opcode?: number,
  ): void => {
    const key = `${reason}:${offset}:${opcode ?? ''}`
    if (diagnosticKeys.has(key)) return
    diagnosticKeys.add(key)
    diagnostics.push({
      mapId: source.id,
      bank: source.fieldScripts.bank,
      scriptId,
      entryOffset,
      offset,
      reason,
      ...(opcode === undefined ? {} : { opcode }),
    })
  }

  if (!isSafeInteger(entryOffset) || entryOffset < codeStart || entryOffset + 2 > bytes.byteLength) {
    addDiagnostic('invalid-entry-offset', entryOffset)
    return { observations, diagnostics, stoppedBeforeBattle: true }
  }

  const worklist: AnalysisState[] = [{
    cursor: entryOffset,
    variables: new Map(),
    flags: new Map(),
    conditions: new Map(),
    comparison: { kind: 'unknown' },
    returnOffsets: [],
  }]
  const visited = new Set<string>()
  const byteOwners = new Int32Array(bytes.byteLength).fill(-1)
  let processedStates = 0

  const enqueue = (state: AnalysisState): void => {
    worklist.push(state)
  }

  while (worklist.length > 0) {
    if (processedStates >= maxStatesPerEntry) {
      addDiagnostic('state-limit', entryOffset)
      stoppedBeforeBattle = true
      break
    }
    processedStates += 1
    const state = worklist.pop()!
    const signature = stateSignature(state)
    if (visited.has(signature)) continue
    visited.add(signature)

    if (!isSafeInteger(state.cursor) || state.cursor < codeStart || state.cursor + 2 > bytes.byteLength) {
      addDiagnostic('invalid-control-flow-target', state.cursor)
      stoppedBeforeBattle = true
      continue
    }
    const existingOwner = byteOwners[state.cursor]
    if (existingOwner !== -1 && existingOwner !== state.cursor) {
      addDiagnostic('invalid-control-flow-target', state.cursor)
      stoppedBeforeBattle = true
      continue
    }

    const commandOffset = state.cursor
    const opcode = readUint16(view, commandOffset)
    const operandBytes = opcodeOperandBytes.get(opcode)
    if (operandBytes === undefined) {
      addDiagnostic('unsupported-opcode', commandOffset, opcode)
      stoppedBeforeBattle = true
      continue
    }
    const nextOffset = commandOffset + 2 + operandBytes
    if (nextOffset > bytes.byteLength) {
      addDiagnostic('truncated-command', commandOffset, opcode)
      stoppedBeforeBattle = true
      continue
    }
    let overlap = false
    for (let offset = commandOffset; offset < nextOffset; offset += 1) {
      if (byteOwners[offset] !== -1 && byteOwners[offset] !== commandOffset) overlap = true
    }
    if (overlap) {
      addDiagnostic('invalid-control-flow-target', commandOffset, opcode)
      stoppedBeforeBattle = true
      continue
    }
    for (let offset = commandOffset; offset < nextOffset; offset += 1) byteOwners[offset] = commandOffset

    switch (opcode) {
      case 2:
      case 21:
        break
      case 17: {
        const variable = state.variables.get(readUint16(view, commandOffset + 2))
        const value = readUint16(view, commandOffset + 4)
        state.comparison = variable === undefined ? { kind: 'unknown' } : { kind: 'known', value: compare(variable, value) }
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 18: {
        const left = state.variables.get(readUint16(view, commandOffset + 2))
        const right = state.variables.get(readUint16(view, commandOffset + 4))
        state.comparison = left === undefined || right === undefined
          ? { kind: 'unknown' }
          : { kind: 'known', value: compare(left, right) }
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 22:
      case 26: {
        const target = nextOffset + readInt32(view, commandOffset + 2)
        state.cursor = target
        if (opcode === 26) {
          if (state.returnOffsets.length >= maxCallDepth) {
            addDiagnostic('call-depth-limit', commandOffset, opcode)
            stoppedBeforeBattle = true
            break
          }
          state.returnOffsets.push(nextOffset)
        }
        enqueue(state)
        break
      }
      case 27: {
        const target = state.returnOffsets.pop()
        if (target !== undefined) {
          state.cursor = target
          enqueue(state)
        }
        break
      }
      case 28:
      case 29: {
        const condition = bytes[commandOffset + 2]!
        const possibilities = branchPossibilities(state.comparison, condition)
        if (!possibilities) {
          addDiagnostic('invalid-branch-condition', commandOffset, opcode)
          stoppedBeforeBattle = true
          break
        }
        const target = nextOffset + readInt32(view, commandOffset + 3)
        for (const possibility of possibilities) {
          const branchState = cloneState(state, possibility.takeBranch ? target : nextOffset)
          if (
            state.comparison.kind === 'flag'
            && possibility.flagState !== undefined
            && !applyFlagConstraint(branchState, state.comparison.flagId, possibility.flagState)
          ) continue
          if (opcode === 29 && possibility.takeBranch) {
            if (branchState.returnOffsets.length >= maxCallDepth) {
              addDiagnostic('call-depth-limit', commandOffset, opcode)
              stoppedBeforeBattle = true
              continue
            }
            branchState.returnOffsets.push(nextOffset)
          }
          enqueue(branchState)
        }
        break
      }
      case 30:
      case 31: {
        const flagId = readUint16(view, commandOffset + 2)
        const flagState = opcode === 30
        state.flags.set(flagId, flagState)
        state.conditions.delete(flagId)
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 32: {
        const flagId = readUint16(view, commandOffset + 2)
        const flagState = state.flags.get(flagId)
        state.comparison = flagState === undefined
          ? { kind: 'flag', flagId }
          : { kind: 'known', value: flagState ? 0 : -1 }
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 33:
      case 34: {
        const flagId = state.variables.get(readUint16(view, commandOffset + 2))
        if (flagId === undefined) {
          state.flags.clear()
          state.conditions.clear()
        } else {
          state.flags.set(flagId, opcode === 33)
          state.conditions.delete(flagId)
        }
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 35: {
        const flagId = state.variables.get(readUint16(view, commandOffset + 2))
        const destination = readUint16(view, commandOffset + 4)
        const flagState = flagId === undefined ? undefined : state.flags.get(flagId)
        if (flagState === undefined) state.variables.delete(destination)
        else state.variables.set(destination, flagState ? 1 : 0)
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 39:
      case 40: {
        const destination = readUint16(view, commandOffset + 2)
        const current = state.variables.get(destination)
        const operand = resolveOperand(readUint16(view, commandOffset + 4), state.variables)
        if (current === undefined || operand === undefined) state.variables.delete(destination)
        else state.variables.set(destination, (opcode === 39 ? current + operand : current - operand) & 0xffff)
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 41: {
        state.variables.set(readUint16(view, commandOffset + 2), readUint16(view, commandOffset + 4))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 42:
      case 43: {
        const destination = readUint16(view, commandOffset + 2)
        const source = readUint16(view, commandOffset + 4)
        const value = opcode === 43 && source < 0x4000 ? source : state.variables.get(source)
        if (value === undefined) state.variables.delete(destination)
        else state.variables.set(destination, value)
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 100:
      case 101: {
        if (opcode === 101) {
          const objectId = resolveOperand(readUint16(view, commandOffset + 2), state.variables)
          const eventFlag = objectId === undefined
            ? undefined
            : source.events?.objects.find((object) => object.id === objectId)?.eventFlag
          if (eventFlag === undefined || eventFlag === 0) state.flags.clear()
          else state.flags.set(eventFlag, true)
        }
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 128: {
        state.variables.delete(readUint16(view, commandOffset + 6))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 220:
      case 588:
      case 683:
      case 748: {
        state.variables.delete(readUint16(view, commandOffset + 2))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 221: {
        state.variables.delete(readUint16(view, commandOffset + 2))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 386:
      case 495: {
        state.variables.delete(readUint16(view, commandOffset + 2))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 546: {
        state.variables.delete(readUint16(view, commandOffset + 3))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 779: {
        state.variables.delete(readUint16(view, commandOffset + 4))
        state.cursor = nextOffset
        enqueue(state)
        break
      }
      case 249:
      case 589: {
        const speciesOperand = readUint16(view, commandOffset + 2)
        const levelOperand = readUint16(view, commandOffset + 4)
        const resolvedSpecies = resolveOperand(speciesOperand, state.variables)
        const resolvedLevel = resolveOperand(levelOperand, state.variables)
        observations.push({
          commandOffset,
          opcode,
          speciesId: resolvedSpecies !== undefined && resolvedSpecies >= 1 && resolvedSpecies <= maxHgssSpeciesId
            ? resolvedSpecies
            : undefined,
          speciesIsLiteral: speciesOperand < 0x4000,
          level: resolvedLevel !== undefined && resolvedLevel >= 1 && resolvedLevel <= maxPokemonLevel
            ? resolvedLevel
            : undefined,
          battleParameter: opcode === 589 ? bytes[commandOffset + 6]! : 0,
          conditions: new Map(state.conditions),
        })
        // Battle commands suspend the native script and may change special
        // variables. Post-battle effects are deliberately outside this index.
        break
      }
      default:
        state.cursor = nextOffset
        enqueue(state)
    }
  }

  return { observations, diagnostics, stoppedBeforeBattle }
}

/**
 * Builds a ROM-only static encounter index.
 *
 * The decoder starts exclusively at ScrDef entry offsets and stops a path at
 * the first unknown/truncated command; it never scans raw bytes for opcode-like
 * patterns. Variable species are emitted only when every proven path reaching
 * the same command agrees, and no earlier path had to be abandoned. This is a
 * deliberate false-negative bias: dynamic scripts stay in diagnostics instead
 * of producing a guessed landmark.
 */
export function buildMapEncounterLandmarkIndex(
  sources: readonly MapEncounterLandmarkSource[],
  options: MapEncounterLandmarkBuildOptions = {},
): MapEncounterLandmarkIndex {
  const landmarks: MapEncounterLandmark[] = []
  const diagnostics: MapEncounterLandmarkDiagnostic[] = []

  for (const source of sources) {
    const baseScriptId = source.fieldScripts.baseScriptId ?? 1
    source.fieldScripts.entryOffsets.forEach((entryOffset, entryIndex) => {
      const scriptId = baseScriptId + entryIndex
      const analysis = analyzeEntry(source, scriptId, entryOffset)
      diagnostics.push(...analysis.diagnostics)
      const observationsByCommand = new Map<string, EncounterObservation[]>()
      for (const observation of analysis.observations) {
        const key = `${observation.opcode}:${observation.commandOffset}`
        const grouped = observationsByCommand.get(key) ?? []
        grouped.push(observation)
        observationsByCommand.set(key, grouped)
      }

      for (const observations of observationsByCommand.values()) {
        const first = observations[0]!
        const speciesIds = new Set(observations.map((observation) => observation.speciesId))
        const hasVariableSpecies = observations.some((observation) => !observation.speciesIsLiteral)
        const speciesId = speciesIds.size === 1 ? first.speciesId : undefined
        if (speciesId === undefined || (hasVariableSpecies && analysis.stoppedBeforeBattle)) {
          diagnostics.push({
            mapId: source.id,
            bank: source.fieldScripts.bank,
            scriptId,
            entryOffset,
            offset: first.commandOffset,
            reason: 'unresolved-species',
            opcode: first.opcode,
          })
          continue
        }
        const levels = new Set(observations.map((observation) => observation.level))
        const level = levels.size === 1 ? first.level : undefined
        const disappearanceFlagId = uniqueObjectFlag(source, scriptId)
        const personalData = options.personalData?.[speciesId]
        // HGSS n'expose aucun booléen « légendaire ». Pour les WildBattle
        // statiques réellement présents dans cette ROM, le groupe d'œuf
        // Undiscovered est la propriété globale qui exclut les rencontres
        // ordinaires; l'opcode séparé exclut en plus tous les pièges Rocket.
        const isRomLegendary = first.opcode === 589
          && personalData !== undefined
          && personalData.eggGroups[0] === 15
        landmarks.push({
          mapId: source.id,
          speciesId,
          ...(level === undefined ? {} : { level }),
          battleParameter: first.battleParameter,
          command: first.opcode === 249 ? 'rocketTrapBattle' : 'wildBattle',
          ...(isRomLegendary ? { isRomLegendary: true as const } : {}),
          conditions: commonConditions(observations),
          ...(disappearanceFlagId === undefined ? {} : { disappearanceFlagId }),
          provenance: {
            bank: source.fieldScripts.bank,
            scriptId,
            entryOffset,
            commandOffset: first.commandOffset,
            opcode: first.opcode,
          },
        })
      }
    })
  }

  landmarks.sort((left, right) => (
    left.mapId - right.mapId
    || left.provenance.bank - right.provenance.bank
    || left.provenance.scriptId - right.provenance.scriptId
    || left.provenance.commandOffset - right.provenance.commandOffset
    || left.speciesId - right.speciesId
  ))
  diagnostics.sort((left, right) => (
    left.mapId - right.mapId
    || left.bank - right.bank
    || left.scriptId - right.scriptId
    || left.offset - right.offset
  ))

  const byMapId = new Map<number, MapEncounterLandmark[]>()
  for (const landmark of landmarks) {
    const entries = byMapId.get(landmark.mapId) ?? []
    entries.push(landmark)
    byMapId.set(landmark.mapId, entries)
  }
  return { landmarks, byMapId, diagnostics }
}
