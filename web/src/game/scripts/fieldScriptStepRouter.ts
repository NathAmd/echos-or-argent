import type { FieldScriptRunner } from './fieldScriptProtocol'

/** Source de vérité du routeur : la valeur effectivement rendue par resume(). */
export type FieldScriptResumeStep = ReturnType<FieldScriptRunner['resume']>
export type FieldScriptStepKind = FieldScriptResumeStep['kind']

/**
 * Propriétaire d'orchestration d'une suspension du runner.
 *
 * Le domaine décrit le sous-système qui doit faire progresser le script, pas
 * uniquement l'aspect visuel de l'étape. Ainsi PC/éclosion sont des sessions,
 * tandis que les applications terrain pilotées par un overlay restent UI.
 */
export type FieldScriptStepDomain =
  | 'ui-dialogue'
  | 'world-movement'
  | 'audio-presentation'
  | 'combat-session'
  | 'lifecycle'

/**
 * Cette déclaration est volontairement exhaustive. Ajouter ou retirer un
 * discriminant de FieldScriptRunner.resume() impose de classer le nouveau cas.
 */
export const fieldScriptStepDomainByKind = Object.freeze({
  safariCustomizer: 'ui-dialogue',
  safariDecorator: 'ui-dialogue',
  photoCapture: 'audio-presentation',
  photoAlbum: 'ui-dialogue',
  message: 'ui-dialogue',
  dialogue: 'ui-dialogue',
  choice: 'ui-dialogue',
  number: 'ui-dialogue',
  nickname: 'ui-dialogue',
  movement: 'world-movement',
  objectState: 'world-movement',
  facePlayer: 'world-movement',
  cameraTarget: 'world-movement',
  objectVisibility: 'world-movement',
  mapProps: 'world-movement',
  fieldMoveEffect: 'world-movement',
  mapPropAnimation: 'world-movement',
  doorAnimation: 'world-movement',
  followerMovement: 'world-movement',
  followerInteraction: 'audio-presentation',
  music: 'audio-presentation',
  soundEffect: 'audio-presentation',
  cry: 'audio-presentation',
  fanfare: 'audio-presentation',
  screenFade: 'audio-presentation',
  screenShake: 'audio-presentation',
  specialCutscene: 'audio-presentation',
  save: 'lifecycle',
  pokemonPortrait: 'audio-presentation',
  gymMechanism: 'world-movement',
  fieldOverlay: 'audio-presentation',
  objectEffect: 'world-movement',
  apricornTree: 'world-movement',
  mapEventState: 'world-movement',
  warp: 'world-movement',
  battle: 'combat-session',
  multiplayer: 'combat-session',
  easyChat: 'ui-dialogue',
  pcBox: 'combat-session',
  pokeathlonApp: 'ui-dialogue',
  frontierRecordsApp: 'ui-dialogue',
  gameClear: 'lifecycle',
  alphPuzzle: 'ui-dialogue',
  alphHiddenRoom: 'ui-dialogue',
  daycareObjects: 'world-movement',
  eggHatch: 'combat-session',
  blackout: 'lifecycle',
  phoneCall: 'ui-dialogue',
  inputWait: 'lifecycle',
  waiting: 'lifecycle',
  ended: 'lifecycle',
} as const satisfies Readonly<Record<FieldScriptStepKind, FieldScriptStepDomain>>)

export type FieldScriptStepForKind<Kind extends FieldScriptStepKind> =
  Extract<FieldScriptResumeStep, { kind: Kind }>

export type FieldScriptStepKindsForDomain<Domain extends FieldScriptStepDomain> = {
  [Kind in FieldScriptStepKind]: (typeof fieldScriptStepDomainByKind)[Kind] extends Domain ? Kind : never
}[FieldScriptStepKind]

export type FieldScriptStepForDomain<Domain extends FieldScriptStepDomain> =
  FieldScriptStepForKind<FieldScriptStepKindsForDomain<Domain>>

export type FieldScriptStepDomainHandlers<Result> = Readonly<{
  [Domain in FieldScriptStepDomain]: (step: FieldScriptStepForDomain<Domain>) => Result
}>

export type FieldScriptStepKindHandlers<Result> = Readonly<{
  [Kind in FieldScriptStepKind]: (step: FieldScriptStepForKind<Kind>) => Result
}>

export type FieldScriptStepRouter<Result> = (step: FieldScriptResumeStep) => Result

export function getFieldScriptStepDomain<Step extends FieldScriptResumeStep>(
  step: Step,
): (typeof fieldScriptStepDomainByKind)[Step['kind']] {
  return fieldScriptStepDomainByKind[step.kind] as (typeof fieldScriptStepDomainByKind)[Step['kind']]
}

export function isFieldScriptStepInDomain<Domain extends FieldScriptStepDomain>(
  step: FieldScriptResumeStep,
  domain: Domain,
): step is FieldScriptStepForDomain<Domain> {
  return fieldScriptStepDomainByKind[step.kind] === domain
}

/**
 * Oriente une étape vers un propriétaire de haut niveau. Chaque callback
 * reçoit uniquement l'union discriminée de son domaine.
 */
export function dispatchFieldScriptStep<Result>(
  step: FieldScriptResumeStep,
  handlers: FieldScriptStepDomainHandlers<Result>,
): Result {
  if (isFieldScriptStepInDomain(step, 'ui-dialogue')) return handlers['ui-dialogue'](step)
  if (isFieldScriptStepInDomain(step, 'world-movement')) return handlers['world-movement'](step)
  if (isFieldScriptStepInDomain(step, 'audio-presentation')) return handlers['audio-presentation'](step)
  if (isFieldScriptStepInDomain(step, 'combat-session')) return handlers['combat-session'](step)
  if (isFieldScriptStepInDomain(step, 'lifecycle')) return handlers.lifecycle(step)
  return assertUnreachableStep(step)
}

/**
 * Dispatch fin pour un hôte qui veut traiter chaque discriminant séparément.
 * Le mapped type impose tous les handlers et contextualise chacun avec son
 * sous-type exact (message possède text, battle possède battle, etc.).
 */
export function dispatchFieldScriptStepByKind<Result>(
  step: FieldScriptResumeStep,
  handlers: FieldScriptStepKindHandlers<Result>,
): Result {
  // L'index et l'argument partagent le même discriminant. TypeScript perd
  // cette corrélation en indexant un mapped type avec une union ; le cast reste
  // local à cette frontière et l'API publique conserve le contrat exhaustif.
  const handler = handlers[step.kind] as (candidate: FieldScriptResumeStep) => Result
  return handler(step)
}

export function createFieldScriptStepRouter<Result>(
  handlers: FieldScriptStepDomainHandlers<Result>,
): FieldScriptStepRouter<Result> {
  return (step) => dispatchFieldScriptStep(step, handlers)
}

export function createFieldScriptStepKindRouter<Result>(
  handlers: FieldScriptStepKindHandlers<Result>,
): FieldScriptStepRouter<Result> {
  return (step) => dispatchFieldScriptStepByKind(step, handlers)
}

function assertUnreachableStep(step: never): never {
  throw new Error(`Étape de script terrain non classée : ${JSON.stringify(step)}`)
}
