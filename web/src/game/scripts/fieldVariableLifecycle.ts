/** Registres locaux à un contexte ScriptEnvironment HGSS. */
export function isHgssFieldScriptTemporaryVariable(variableId: number): boolean {
  return variableId >= 0x8000 && variableId <= 0x800f
}

/** VAR_TEMP_0…F, recréées à zéro à chaque chargement de carte. */
export function isHgssFieldMapTemporaryVariable(variableId: number): boolean {
  return variableId >= 0x4000 && variableId <= 0x400f
}
