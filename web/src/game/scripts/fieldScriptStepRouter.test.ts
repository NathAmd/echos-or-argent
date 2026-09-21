import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createFieldScriptStepKindRouter,
  createFieldScriptStepRouter,
  dispatchFieldScriptStepByKind,
  fieldScriptStepDomainByKind,
  getFieldScriptStepDomain,
  isFieldScriptStepInDomain,
  type FieldScriptResumeStep,
  type FieldScriptStepDomain,
  type FieldScriptStepDomainHandlers,
  type FieldScriptStepForDomain,
  type FieldScriptStepForKind,
  type FieldScriptStepKind,
  type FieldScriptStepKindHandlers,
} from './fieldScriptStepRouter'

const expectedKindsByDomain = {
  'ui-dialogue': [
    'safariCustomizer', 'safariDecorator', 'photoAlbum', 'message', 'dialogue',
    'choice', 'number', 'nickname', 'easyChat', 'pokeathlonApp',
    'frontierRecordsApp', 'alphPuzzle', 'alphHiddenRoom', 'phoneCall',
  ],
  'world-movement': [
    'movement', 'objectState', 'facePlayer', 'cameraTarget', 'objectVisibility',
    'mapProps', 'fieldMoveEffect', 'mapPropAnimation', 'doorAnimation', 'followerMovement',
    'gymMechanism', 'objectEffect', 'apricornTree', 'mapEventState', 'warp',
    'daycareObjects',
  ],
  'audio-presentation': [
    'photoCapture', 'followerInteraction', 'music', 'soundEffect', 'cry',
    'fanfare', 'screenFade', 'screenShake', 'specialCutscene',
    'pokemonPortrait', 'fieldOverlay',
  ],
  'combat-session': ['battle', 'multiplayer', 'pcBox', 'eggHatch'],
  lifecycle: ['save', 'gameClear', 'blackout', 'inputWait', 'waiting', 'ended'],
} as const satisfies Readonly<Record<FieldScriptStepDomain, readonly FieldScriptStepKind[]>>

const allExpectedKinds: readonly FieldScriptStepKind[] = Object.values(expectedKindsByDomain).flat()

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false

const exhaustiveClassificationGuard: Equal<keyof typeof fieldScriptStepDomainByKind, FieldScriptStepKind> = true
const exhaustiveHandlerGuard: Equal<keyof FieldScriptStepKindHandlers<void>, FieldScriptStepKind> = true

function stepWithKind(kind: FieldScriptStepKind): FieldScriptResumeStep {
  return { kind } as FieldScriptResumeStep
}

function createRuntimeKindHandlers(calls: string[]): FieldScriptStepKindHandlers<string> {
  return Object.fromEntries(allExpectedKinds.map((kind) => [
    kind,
    (step: FieldScriptResumeStep) => {
      calls.push(step.kind)
      return `kind:${step.kind}`
    },
  ])) as FieldScriptStepKindHandlers<string>
}

describe('routeur des étapes de script terrain', () => {
  it('classe exactement les 51 discriminants connus de FieldScriptRunner.resume()', () => {
    const classifiedKinds = Object.keys(fieldScriptStepDomainByKind).sort()
    const expectedKinds = [...allExpectedKinds].sort()

    expect(exhaustiveClassificationGuard).toBe(true)
    expect(exhaustiveHandlerGuard).toBe(true)
    expect(allExpectedKinds).toHaveLength(51)
    expect(new Set(allExpectedKinds).size).toBe(51)
    expect(classifiedKinds).toEqual(expectedKinds)

    for (const [domain, kinds] of Object.entries(expectedKindsByDomain) as Array<[
      FieldScriptStepDomain,
      readonly FieldScriptStepKind[],
    ]>) {
      for (const kind of kinds) expect(fieldScriptStepDomainByKind[kind]).toBe(domain)
    }
  })

  it('dispatch chaque kind vers son propriétaire de domaine avec le discriminant intact', () => {
    const calls: string[] = []
    const handle = (domain: FieldScriptStepDomain) => (step: FieldScriptResumeStep): string => {
      calls.push(`${domain}:${step.kind}`)
      return domain
    }
    const handlers: FieldScriptStepDomainHandlers<string> = {
      'ui-dialogue': handle('ui-dialogue'),
      'world-movement': handle('world-movement'),
      'audio-presentation': handle('audio-presentation'),
      'combat-session': handle('combat-session'),
      lifecycle: handle('lifecycle'),
    }
    const router = createFieldScriptStepRouter(handlers)

    for (const kind of allExpectedKinds) {
      const step = stepWithKind(kind)
      const expectedDomain = fieldScriptStepDomainByKind[kind]
      expect(getFieldScriptStepDomain(step)).toBe(expectedDomain)
      expect(router(step)).toBe(expectedDomain)
    }
    expect(calls).toHaveLength(51)
  })

  it('offre aussi un dispatch exhaustif au sous-type exact de chaque kind', () => {
    const calls: string[] = []
    const handlers = createRuntimeKindHandlers(calls)
    const router = createFieldScriptStepKindRouter(handlers)

    for (const kind of allExpectedKinds) {
      expect(dispatchFieldScriptStepByKind(stepWithKind(kind), handlers)).toBe(`kind:${kind}`)
      expect(router(stepWithKind(kind))).toBe(`kind:${kind}`)
    }
    expect(calls).toHaveLength(102)
  })

  it('préserve le typage discriminé des handlers et des gardes de domaine', () => {
    const message = { kind: 'message', messageId: 7, text: 'Bonjour' } satisfies FieldScriptStepForKind<'message'>
    const battle = { kind: 'battle', battle: { kind: 'tutorial' } } satisfies FieldScriptStepForKind<'battle'>
    const messageHandler: FieldScriptStepKindHandlers<number>['message'] = (step) => step.text.length + step.messageId

    expectTypeOf(getFieldScriptStepDomain(message)).toEqualTypeOf<'ui-dialogue'>()
    expectTypeOf(messageHandler).parameter(0).toEqualTypeOf<FieldScriptStepForKind<'message'>>()
    expect(messageHandler(message)).toBe(14)
    expect(isFieldScriptStepInDomain(battle, 'combat-session')).toBe(true)

    const assertCombatNarrowing = (candidate: FieldScriptResumeStep): void => {
      if (!isFieldScriptStepInDomain(candidate, 'combat-session')) return
      expectTypeOf(candidate).toEqualTypeOf<FieldScriptStepForDomain<'combat-session'>>()
      expect(candidate.kind).toBe('battle')
    }
    assertCombatNarrowing(battle)
  })
})
