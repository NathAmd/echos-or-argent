export function formatPokemonStatus(status: number): string | undefined {
  const labels: string[] = []
  if ((status & 0x7) !== 0) labels.push('Sommeil')
  if ((status & 0x80) !== 0) labels.push('Poison grave')
  else if ((status & 0x8) !== 0) labels.push('Poison')
  if ((status & 0x10) !== 0) labels.push('Brûlure')
  if ((status & 0x20) !== 0) labels.push('Gel')
  if ((status & 0x40) !== 0) labels.push('Paralysie')
  return labels.length > 0 ? labels.join(', ') : undefined
}

export type PokemonBattleStatusPresentation = {
  kind: 'sleep' | 'poison' | 'bad-poison' | 'burn' | 'freeze' | 'paralysis'
  shortLabel: 'SOM' | 'PSN' | 'TOX' | 'BRÛ' | 'GEL' | 'PAR'
  label: string
}

/** Native HGSS party-status priority, formatted for the compact battle HUD. */
export function getPokemonBattleStatusPresentation(status: number): PokemonBattleStatusPresentation | undefined {
  if ((status & 0x7) !== 0) return { kind: 'sleep', shortLabel: 'SOM', label: 'Sommeil' }
  if ((status & 0x80) !== 0) return { kind: 'bad-poison', shortLabel: 'TOX', label: 'Poison grave' }
  if ((status & 0x8) !== 0) return { kind: 'poison', shortLabel: 'PSN', label: 'Poison' }
  if ((status & 0x10) !== 0) return { kind: 'burn', shortLabel: 'BRÛ', label: 'Brûlure' }
  if ((status & 0x20) !== 0) return { kind: 'freeze', shortLabel: 'GEL', label: 'Gel' }
  if ((status & 0x40) !== 0) return { kind: 'paralysis', shortLabel: 'PAR', label: 'Paralysie' }
  return undefined
}
