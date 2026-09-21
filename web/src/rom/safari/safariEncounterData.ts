import type { RomFile } from '../../ndsTypes'

export const HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH = '/a/2/3/0'
export const hgssSafariAreaCount = 12
export const hgssSafariBaseSlotCount = 10

export const hgssSafariEncounterMethods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const
export type HgssSafariEncounterMethod = typeof hgssSafariEncounterMethods[number]

export const hgssSafariEncounterTimes = ['morning', 'day', 'night'] as const
export type HgssSafariEncounterTime = typeof hgssSafariEncounterTimes[number]

export type HgssSafariAreaId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
export type HgssSafariBlockType = 0 | 1 | 2 | 3 | 4

export type HgssSafariEncounterSlot = {
  speciesId: number
  level: number
}

export type HgssSafariBonusCondition = {
  blockType1: HgssSafariBlockType
  blockCount1: number
  blockType2: HgssSafariBlockType
  blockCount2: number
}

export type HgssSafariEncounterMethodData = {
  bonusCount: number
  base: Record<HgssSafariEncounterTime, HgssSafariEncounterSlot[]>
  bonus: Record<HgssSafariEncounterTime, HgssSafariEncounterSlot[]>
  bonusConditions: HgssSafariBonusCondition[]
}

export type HgssSafariAreaEncounterData = {
  areaId: HgssSafariAreaId
  methods: Record<HgssSafariEncounterMethod, HgssSafariEncounterMethodData>
}

export type HgssSafariEncounterCatalog = HgssSafariAreaEncounterData[]

const headerSize = 8
const slotSize = 4
const conditionSize = 4
const maximumBonusSlotCount = hgssSafariBaseSlotCount

function assertAreaId(areaId: number): asserts areaId is HgssSafariAreaId {
  if (!Number.isInteger(areaId) || areaId < 0 || areaId >= hgssSafariAreaCount) {
    throw new Error(`L'identifiant de zone Safari HGSS ${areaId} est invalide.`)
  }
}

function readSlot(view: DataView, offset: number, areaId: number, method: HgssSafariEncounterMethod): HgssSafariEncounterSlot {
  if (offset < 0 || offset + slotSize > view.byteLength) {
    throw new Error(`Les rencontres Safari HGSS de la zone ${areaId} sont tronquees dans la table ${method}.`)
  }
  return {
    speciesId: view.getUint16(offset, true),
    level: view.getUint16(offset + 2, true),
  }
}

export function decodeHgssSafariAreaEncounterData(payload: Uint8Array, areaId: number): HgssSafariAreaEncounterData {
  assertAreaId(areaId)
  if (payload.byteLength < headerSize) {
    throw new Error(`Les rencontres Safari HGSS de la zone ${areaId} ne contiennent pas leur en-tete de ${headerSize} octets.`)
  }
  if (payload[5] !== 0 || payload[6] !== 0 || payload[7] !== 0) {
    throw new Error(`L'en-tete des rencontres Safari HGSS de la zone ${areaId} contient un remplissage invalide.`)
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  let cursor = headerSize
  const methods = {} as Record<HgssSafariEncounterMethod, HgssSafariEncounterMethodData>

  hgssSafariEncounterMethods.forEach((method, methodIndex) => {
    const bonusCount = payload[methodIndex]!
    if (bonusCount > maximumBonusSlotCount) {
      throw new Error(`La table ${method} de la zone Safari HGSS ${areaId} contient ${bonusCount} bonus au lieu de ${maximumBonusSlotCount} au maximum.`)
    }

    const base = {} as Record<HgssSafariEncounterTime, HgssSafariEncounterSlot[]>
    hgssSafariEncounterTimes.forEach((time) => {
      base[time] = Array.from({ length: hgssSafariBaseSlotCount }, () => {
        const slot = readSlot(view, cursor, areaId, method)
        cursor += slotSize
        return slot
      })
    })

    const bonus = {} as Record<HgssSafariEncounterTime, HgssSafariEncounterSlot[]>
    hgssSafariEncounterTimes.forEach((time) => {
      bonus[time] = Array.from({ length: bonusCount }, () => {
        const slot = readSlot(view, cursor, areaId, method)
        cursor += slotSize
        return slot
      })
    })

    const bonusConditions = Array.from({ length: bonusCount }, (): HgssSafariBonusCondition => {
      if (cursor + conditionSize > payload.byteLength) {
        throw new Error(`Les conditions de bonus Safari HGSS de la zone ${areaId} sont tronquees dans la table ${method}.`)
      }
      const blockType1 = payload[cursor]!
      const blockCount1 = payload[cursor + 1]!
      const blockType2 = payload[cursor + 2]!
      const blockCount2 = payload[cursor + 3]!
      cursor += conditionSize
      if (blockType1 > 4 || blockType2 > 4) {
        throw new Error(`La table ${method} de la zone Safari HGSS ${areaId} reference un type de bloc invalide.`)
      }
      return {
        blockType1: blockType1 as HgssSafariBlockType,
        blockCount1,
        blockType2: blockType2 as HgssSafariBlockType,
        blockCount2,
      }
    })

    methods[method] = { bonusCount, base, bonus, bonusConditions }
  })

  if (cursor !== payload.byteLength) {
    throw new Error(`Les rencontres Safari HGSS de la zone ${areaId} utilisent ${cursor} octets sur ${payload.byteLength}.`)
  }
  return { areaId, methods }
}

export function decodeHgssSafariEncounterCatalog(rom: Uint8Array, archive: RomFile): HgssSafariEncounterCatalog {
  if (archive.path !== HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH) {
    throw new Error(`L'archive de rencontres Safari HGSS attendue est ${HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH}, pas ${archive.path}.`)
  }
  if (archive.archiveMembers.length !== hgssSafariAreaCount) {
    throw new Error(`L'archive de rencontres Safari HGSS contient ${archive.archiveMembers.length} zones au lieu de ${hgssSafariAreaCount}.`)
  }
  archive.archiveMembers.forEach((member, areaId) => {
    if (member.index !== areaId) {
      throw new Error(`L'archive de rencontres Safari HGSS n'est pas contigue a la zone ${areaId}.`)
    }
    if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
      throw new Error(`Le membre ${areaId} de l'archive de rencontres Safari HGSS depasse la ROM.`)
    }
  })
  return archive.archiveMembers.map((member, areaId) => {
    return decodeHgssSafariAreaEncounterData(
      rom.subarray(member.offset, member.offset + member.size),
      areaId,
    )
  })
}
