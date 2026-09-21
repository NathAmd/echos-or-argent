import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { decodeConfirmedHgssBattleMotion, isConfirmedHgssNoOpNativeFunction } from '../../game/battle/battleAnimationPlayback'
import { classifyDoubleBattleMoveSupport, classifySimpleBattleMoveSupport } from '../../game/battle/simpleBattleEffectSupport'
import { deriveInitialMoveIds } from '../pokemon/levelUpLearnset'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_MOVE_EFFECT_AUDIT === '1' && existsSync(romPath) ? it : it.skip

probe('inventories every move effect used by the French HeartGold ROM', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  const namedMoves = inventory.pokemonCatalog.moves.filter((move) => (
    move?.moveId !== 0 && inventory.pokemonCatalog.moveNames[move.moveId]?.trim()
  ))
  const groups = new Map<number, string[]>()
  for (const move of namedMoves) {
    const moves = groups.get(move.effect) ?? []
    moves.push(`${move.moveId}:${inventory.pokemonCatalog.moveNames[move.moveId]}:${move.power}`)
    groups.set(move.effect, moves)
  }
  const effects = [...groups].sort(([left], [right]) => left - right).map(([effect, moves]) => ({ effect, moves }))
  const semanticCoverage = namedMoves.map((move) => ({
      moveId: move.moveId,
      name: inventory.pokemonCatalog.moveNames[move.moveId],
      effect: move.effect,
      power: move.power,
      support: classifySimpleBattleMoveSupport(move),
  }))
  expect(semanticCoverage).toHaveLength(467)
  expect(effects).toHaveLength(257)
  const supportCounts = semanticCoverage.reduce<Record<string, number>>((counts, move) => {
    counts[move.support] = (counts[move.support] ?? 0) + 1
    return counts
  }, {})
  const doubleBattleCoverage = semanticCoverage.map((move) => ({
    ...move,
    support: classifyDoubleBattleMoveSupport(inventory.pokemonCatalog.moves[move.moveId]!),
  }))
  const doubleSupportCounts = doubleBattleCoverage.reduce<Record<string, number>>((counts, move) => {
    counts[move.support] = (counts[move.support] ?? 0) + 1
    return counts
  }, {})
  const summarizeUsage = (moveIds: ReadonlySet<number>) => {
    const moves = semanticCoverage.filter(({ moveId }) => moveIds.has(moveId))
    const counts = moves.reduce<Record<string, number>>((result, move) => {
      result[move.support] = (result[move.support] ?? 0) + 1
      return result
    }, {})
    return {
      moveCount: moves.length,
      counts,
      incompleteMoves: moves.filter(({ support }) => support !== 'implemented'),
    }
  }
  const trainerMoveIds = new Set<number>()
  const doubleTrainerMoveIds = new Set<number>()
  for (const trainer of inventory.trainerCatalog) for (const pokemon of trainer.party) {
    const moveIds = pokemon.moveIds?.filter((moveId) => moveId > 0)
      ?? deriveInitialMoveIds(inventory.pokemonCatalog.levelUpLearnsets[pokemon.speciesId] ?? [], pokemon.level)
    for (const moveId of moveIds) {
      trainerMoveIds.add(moveId)
      if (trainer.doubleBattle) doubleTrainerMoveIds.add(moveId)
    }
  }
  const levelUpMoveIds = new Set(inventory.pokemonCatalog.levelUpLearnsets.flatMap((learnset) => learnset.map(({ moveId }) => moveId)))
  console.log(JSON.stringify(effects))
  const controlNames = new Set(['Call', 'Return', 'Jump', 'JumpIfEqual', 'JumpIfEffectChanceOdd', 'JumpIfEffectChance', 'JumpIfBattlerSide', 'JumpIfWeather', 'JumpIfContest', 'JumpIfFriendlyFire'])
  const controls = inventory.battleAnimationCatalog.moveScripts.flatMap((script) => script.instructions.flatMap((instruction) => (
    controlNames.has(instruction.name) ? [{ scriptId: script.id, offsetWords: instruction.offsetWords, name: instruction.name, operands: [...instruction.operands] }] : []
  )))
  const animationInstructions = inventory.battleAnimationCatalog.moveScripts.flatMap((script) => {
    let currentParticleSystemIndex: number | undefined
    const activeEmitterHandles = new Set<string>()
    return script.instructions.map((instruction) => {
      if (instruction.name === 'CreateEmitter' || instruction.name === 'CreateEmitterEx') {
        currentParticleSystemIndex = instruction.operands[0]
        const emitterId = instruction.name === 'CreateEmitterEx' ? instruction.operands[1] : 0
        if (currentParticleSystemIndex !== undefined && emitterId !== undefined) {
          activeEmitterHandles.add(`${currentParticleSystemIndex}:${emitterId}`)
        }
      } else if (instruction.name === 'CreateEmitterForMove' || instruction.name === 'CreateEmitterForFriendlyFire') {
        currentParticleSystemIndex = instruction.operands[0]
      }
      const decodedMotion = decodeConfirmedHgssBattleMotion(instruction, currentParticleSystemIndex)
      const emitterResolvable = decodedMotion?.kind !== 'moveEmitter' && decodedMotion?.kind !== 'revolveEmitter'
        ? true
        : activeEmitterHandles.has(`${decodedMotion.particleSystemIndex}:${decodedMotion.emitterId}`)
      const entry = { scriptId: script.id, instruction, decodedMotion, emitterResolvable }
      if (instruction.name === 'UnloadParticleSystem') {
        const particleSystemIndex = instruction.operands[0]
        for (const handle of activeEmitterHandles) {
          if (handle.startsWith(`${particleSystemIndex}:`)) activeEmitterHandles.delete(handle)
        }
      }
      return entry
    })
  })
  const callFunctions = animationInstructions.filter(({ instruction }) => instruction.name === 'CallFunc')
  const renderedCallFunctions = callFunctions.filter(({ decodedMotion, emitterResolvable }) => decodedMotion !== undefined && emitterResolvable)
  const noOpCallFunctions = callFunctions.filter(({ instruction }) => isConfirmedHgssNoOpNativeFunction(instruction))
  const nativeFallbacks = callFunctions.filter(({ instruction, decodedMotion, emitterResolvable }) => (
    (!decodedMotion || !emitterResolvable) && !isConfirmedHgssNoOpNativeFunction(instruction)
  ))
  const explicitFallbackNames = new Set([
    'SwitchBg', 'SwitchBgEx', 'RestoreBg', 'StartBattlerSlideIn', 'StartBattlerSlideOut',
    'HgssUnknown85', 'HgssUnknown86', 'WaitForLRX',
  ])
  const explicitFallbacks = animationInstructions.filter(({ instruction }) => explicitFallbackNames.has(instruction.name))
  const movingSoundInstructions = animationInstructions.filter(({ instruction }) => instruction.name.startsWith('PlayMovingSoundEffect'))
  const countBy = <T extends string | number>(values: readonly T[]) => Object.fromEntries(
    [...new Map<T, number>(values.map((value) => [value, 0])).keys()]
      .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }))
      .map((value) => [value, values.filter((candidate) => candidate === value).length]),
  )
  console.log(JSON.stringify({ controlCount: controls.length, controls: controls.slice(0, 80) }))
  const targetControls = controls.filter(({ name }) => name !== 'Return')
  const candidates = { absoluteWords: 0, absoluteBytes: 0, relativeWords: 0, relativeBytes: 0 }
  const candidatesByCommand = new Map<string, typeof candidates & { count: number }>()
  const branchOperandIndexes: Record<string, number[]> = {
    Call: [0],
    Jump: [0],
    JumpIfEqual: [2],
    JumpIfEffectChanceOdd: [0, 1],
    JumpIfEffectChance: [1],
    JumpIfBattlerSide: [1, 2],
    JumpIfWeather: [0, 1, 2, 3, 4],
    JumpIfContest: [0],
    JumpIfFriendlyFire: [0],
  }
  for (const control of targetControls) {
    const script = inventory.battleAnimationCatalog.moveScripts[control.scriptId]!
    const instruction = script.instructions.find(({ offsetWords }) => offsetWords === control.offsetWords)!
    const offsets = new Set(script.instructions.map(({ offsetWords }) => offsetWords))
    for (const operandIndex of branchOperandIndexes[control.name] ?? []) {
      const encoded = instruction.operands[operandIndex]!
      const signed = encoded | 0
      const operandOffset = instruction.offsetWords + 1 + operandIndex
      const commandCandidates = candidatesByCommand.get(control.name) ?? { absoluteWords: 0, absoluteBytes: 0, relativeWords: 0, relativeBytes: 0, count: 0 }
      commandCandidates.count += 1
      if (offsets.has(signed)) { candidates.absoluteWords += 1; commandCandidates.absoluteWords += 1 }
      if (signed % 4 === 0 && offsets.has(signed / 4)) { candidates.absoluteBytes += 1; commandCandidates.absoluteBytes += 1 }
      if (offsets.has(operandOffset + signed)) { candidates.relativeWords += 1; commandCandidates.relativeWords += 1 }
      if (signed % 4 === 0 && offsets.has(operandOffset + signed / 4)) { candidates.relativeBytes += 1; commandCandidates.relativeBytes += 1 }
      candidatesByCommand.set(control.name, commandCandidates)
    }
  }
  console.log(JSON.stringify({ branchTargetCandidates: candidates, candidatesByCommand: Object.fromEntries(candidatesByCommand), targetControls: targetControls.length }))
  if (process.env.MOVE_EFFECT_AUDIT_REPORT_PATH) {
    const reportPath = resolve(process.env.MOVE_EFFECT_AUDIT_REPORT_PATH)
    await writeFile(reportPath, `${JSON.stringify({
      format: 'pokemaster-hgss-move-effect-inventory',
      revision: 4,
      moveCount: semanticCoverage.length,
      effectCount: effects.length,
      effects,
      semanticCoverage: {
        engine: 'simple-1v1',
        complete: semanticCoverage.every(({ support }) => support === 'implemented'),
        counts: supportCounts,
        incompleteMoves: semanticCoverage.filter(({ support }) => support !== 'implemented'),
        trainerUsage: summarizeUsage(trainerMoveIds),
        levelUpUsage: summarizeUsage(levelUpMoveIds),
      },
      animationPresentationCoverage: {
        scriptCount: inventory.battleAnimationCatalog.moveScripts.length,
        instructionCount: animationInstructions.length,
        callFunctionCount: callFunctions.length,
        renderedCallFunctionCount: renderedCallFunctions.length,
        noOpCallFunctionCount: noOpCallFunctions.length,
        nativeFallbackCount: nativeFallbacks.length,
        nativeFallbacksByFunctionId: countBy(nativeFallbacks.map(({ instruction }) => instruction.operands[0] ?? -1)),
        nativeFallbackProfiles: countBy(nativeFallbacks.map(({ instruction }) => `${instruction.operands[0] ?? -1}:${[...instruction.operands.slice(1)].map((operand) => operand | 0).join(',')}`)),
        explicitInstructionFallbackCount: explicitFallbacks.length,
        explicitFallbacksByName: countBy(explicitFallbacks.map(({ instruction }) => instruction.name)),
        movingSoundInstructionCount: movingSoundInstructions.length,
        movingSoundProfiles: countBy(movingSoundInstructions.map(({ instruction }) => `${instruction.name}:${[...instruction.operands].map((operand) => operand | 0).join(',')}`)),
      },
      doubleBattleCoverage: {
        engine: 'double-2v2',
        complete: doubleBattleCoverage.every(({ support }) => support === 'implemented'),
        counts: doubleSupportCounts,
        incompleteMoves: doubleBattleCoverage.filter(({ support }) => support !== 'implemented'),
        trainerUsage: (() => {
          const moves = doubleBattleCoverage.filter(({ moveId }) => doubleTrainerMoveIds.has(moveId))
          return {
            moveCount: moves.length,
            counts: moves.reduce<Record<string, number>>((counts, move) => {
              counts[move.support] = (counts[move.support] ?? 0) + 1
              return counts
            }, {}),
            incompleteMoves: moves.filter(({ support }) => support !== 'implemented'),
          }
        })(),
      },
      animationControls: {
        count: controls.length,
        branchTargetCandidates: candidates,
        candidatesByCommand: Object.fromEntries(candidatesByCommand),
        targetControls: targetControls.length,
      },
    }, null, 2)}\n`)
  }
}, 120_000)
