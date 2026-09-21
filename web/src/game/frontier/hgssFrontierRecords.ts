export type HgssFrontierFacility = 'tower' | 'factory' | 'hall' | 'castle' | 'arcade'

export type HgssFrontierRecordView = 'single' | 'double' | 'multi'

export type HgssFrontierRecordRow = {
  label: string
  value: number
  tone?: 'current' | 'record'
}

export type HgssFrontierRecordPage = {
  facility: HgssFrontierFacility
  facilityId: number
  title: string
  view: HgssFrontierRecordView
  viewLabel: string
  subject?: string
  rows: readonly HgssFrontierRecordRow[]
}

const viewLabels: readonly ['Simple', 'Double', 'Multi'] = ['Simple', 'Double', 'Multi']

function read(records: ReadonlyMap<number, number>, statId: number): number {
  return records.get(statId) ?? 0
}

function towerRows(records: ReadonlyMap<number, number>, view: number): HgssFrontierRecordRow[] {
  if (view === 2) {
    return [
      { label: 'Multi avec Dresseur · actuel', value: read(records, 5), tone: 'current' },
      { label: 'Multi avec Dresseur · record', value: read(records, 4), tone: 'record' },
      { label: 'Multi avec ami · actuel', value: read(records, 7), tone: 'current' },
      { label: 'Multi avec ami · record', value: read(records, 6), tone: 'record' },
    ]
  }
  return [
    { label: 'Série actuelle', value: read(records, view === 0 ? 1 : 3), tone: 'current' },
    { label: 'Record', value: read(records, view === 0 ? 0 : 2), tone: 'record' },
  ]
}

function factoryRows(records: ReadonlyMap<number, number>, view: number): HgssFrontierRecordRow[] {
  const previousBases = [0x0b, 0x13, 0x1b, 0x73] as const
  const currentBases = [0x0d, 0x15, 0x1d, 0x75] as const
  const tradePreviousBases = [0x0a, 0x12, 0x1a, 0x72] as const
  const tradeCurrentBases = [0x0c, 0x14, 0x1c, 0x74] as const
  return [0, 1].flatMap((levelMode) => {
    const level = levelMode === 0 ? 'Niveau 50' : 'Niveau libre'
    return [
      { label: `${level} · série précédente`, value: read(records, previousBases[view]! + levelMode * 4), tone: 'record' as const },
      { label: `${level} · série actuelle`, value: read(records, currentBases[view]! + levelMode * 4), tone: 'current' as const },
      { label: `${level} · échanges précédents`, value: read(records, tradePreviousBases[view]! + levelMode * 4), tone: 'record' as const },
      { label: `${level} · échanges actuels`, value: read(records, tradeCurrentBases[view]! + levelMode * 4), tone: 'current' as const },
    ]
  })
}

function hallRows(records: ReadonlyMap<number, number>, view: number, speciesId: number): HgssFrontierRecordRow[] {
  const speciesStat = [0x24, 0x30, 0x3c, 0x7c][view]!
  const recordStat = [0x23, 0x2f, 0x3b, 0x7b][view]!
  const isDisplayedSpecies = read(records, speciesStat) === speciesId
  return [
    { label: 'Record de ce Pokémon', value: isDisplayedSpecies ? read(records, recordStat) : 0, tone: 'record' },
  ]
}

function castleRows(records: ReadonlyMap<number, number>, view: number): HgssFrontierRecordRow[] {
  const currentStreak = [0x46, 0x4e, 0x56, 0x86][view]!
  const recordStreak = [0x4a, 0x52, 0x5a, 0x8a][view]!
  const currentPoints = [0x47, 0x4f, 0x57, 0x87][view]!
  const recordPoints = [0x48, 0x50, 0x58, 0x88][view]!
  return [
    { label: 'Série actuelle', value: read(records, currentStreak), tone: 'current' },
    { label: 'Record', value: read(records, recordStreak), tone: 'record' },
    { label: 'Points Castel actuels', value: read(records, currentPoints), tone: 'current' },
    { label: 'Record de Points Castel', value: read(records, recordPoints), tone: 'record' },
  ]
}

function arcadeRows(records: ReadonlyMap<number, number>, view: number): HgssFrontierRecordRow[] {
  const currentStat = [0x5e, 0x60, 0x62, 0x8e][view]!
  const recordStat = [0x5f, 0x61, 0x63, 0x8f][view]!
  return [
    { label: 'Parties terminées · actuel', value: read(records, currentStat), tone: 'current' },
    { label: 'Parties terminées · record', value: read(records, recordStat), tone: 'record' },
  ]
}

/**
 * Projection mono-écran de l'overlay 86. Les identifiants de stats et les
 * cinq variantes suivent directement ov86_021E60B8 et unk_0205BFF0 de HGSS.
 */
export function createHgssFrontierRecordPage(
  facilityId: number,
  viewIndex: number,
  recordIndex: number,
  records: ReadonlyMap<number, number>,
  speciesNames: readonly string[] = [],
): HgssFrontierRecordPage {
  if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex > 2) {
    throw new Error(`Vue de records Frontier HGSS invalide: ${viewIndex}.`)
  }
  const view = (['single', 'double', 'multi'] as const)[viewIndex]!
  const viewLabel = viewLabels[viewIndex]!
  switch (facilityId) {
    case 1:
      return { facility: 'tower', facilityId, title: 'Tour de Combat', view, viewLabel, rows: towerRows(records, viewIndex) }
    case 2:
    case 3:
      return { facility: 'factory', facilityId, title: 'Usine de Combat', view, viewLabel, rows: factoryRows(records, viewIndex) }
    case 5:
      return {
        facility: 'hall',
        facilityId,
        title: 'Scène de Combat',
        view,
        viewLabel,
        subject: speciesNames[recordIndex] ?? `Pokémon ${recordIndex}`,
        rows: hallRows(records, viewIndex, recordIndex),
      }
    case 4:
      return { facility: 'castle', facilityId, title: 'Castel de Combat', view, viewLabel, rows: castleRows(records, viewIndex) }
    case 6:
      return { facility: 'arcade', facilityId, title: 'Arcade de Combat', view, viewLabel, rows: arcadeRows(records, viewIndex) }
    default:
      throw new Error(`Bâtiment Frontier HGSS invalide: ${facilityId}.`)
  }
}
