import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRomInventory } from '../src/nds.ts'

function fix32(value: number): number {
  return value / 4096
}

function parseRecord(view: DataView, offset: number) {
  return {
    propModelId: view.getUint32(offset, true),
    position: [
      fix32(view.getInt32(offset + 4, true)),
      fix32(view.getInt32(offset + 8, true)),
      fix32(view.getInt32(offset + 12, true)),
    ],
    scale: [
      fix32(view.getInt32(offset + 28, true)),
      fix32(view.getInt32(offset + 32, true)),
      fix32(view.getInt32(offset + 36, true)),
    ],
    raw: Array.from({ length: 12 }, (_, index) => view.getUint32(offset + index * 4, true)),
  }
}

function scoreRecord(record: ReturnType<typeof parseRecord>, fieldModelCount: number): number {
  let score = 0
  if (record.propModelId > 0 && record.propModelId < fieldModelCount) score += 2
  if (record.position.every((value) => Number.isFinite(value) && Math.abs(value) <= 256)) score += 1
  if (record.scale.every((value) => Number.isFinite(value) && value > 0 && value <= 8)) score += 2
  return score
}

function inspectMember(bytes: Uint8Array, offset: number, size: number, fieldModelCount: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
  const terrainSize = view.getUint32(0, true)
  const propListSize = view.getUint32(4, true)
  const embeddedModelSize = view.getUint32(8, true)
  const extraModelDataSize = view.getUint32(12, true)
  const propListOffset = 0x14 + terrainSize
  const embeddedModelOffset = size - embeddedModelSize - extraModelDataSize
  const candidates: Array<{ shift: number, score: number, firstRecord: ReturnType<typeof parseRecord> | undefined }> = []
  for (let shift = 0; shift <= 128 && propListOffset + shift + 0x30 <= embeddedModelOffset; shift += 4) {
    const sampleOffsets = [propListOffset + shift, propListOffset + shift + 0x30, propListOffset + shift + 0x60]
      .filter((sampleOffset) => sampleOffset + 0x30 <= embeddedModelOffset)
    const sampleRecords = sampleOffsets.map((sampleOffset) => parseRecord(view, sampleOffset))
    const score = sampleRecords.reduce((sum, record) => sum + scoreRecord(record, fieldModelCount), 0)
    candidates.push({ shift, score, firstRecord: sampleRecords[0] })
  }
  candidates.sort((left, right) => right.score - left.score || left.shift - right.shift)
  return {
    size,
    terrainSize,
    propListSize,
    embeddedModelSize,
    extraModelDataSize,
    propListOffset,
    declaredPropListEnd: propListOffset + propListSize,
    embeddedModelOffset,
    gapBeforeModel: embeddedModelOffset - (propListOffset + propListSize),
    sampleAtDeclaredStart: Array.from({ length: 4 }, (_, index) => parseRecord(view, propListOffset + index * 0x30)),
    sampleAtShift88: propListOffset + 88 + 4 * 0x30 <= embeddedModelOffset
      ? Array.from({ length: 4 }, (_, index) => parseRecord(view, propListOffset + 88 + index * 0x30))
      : [],
    bestCandidates: candidates.slice(0, 8),
  }
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const romPath = path.resolve(here, '../../Pokemon - Version Or HeartGold (France).nds')
  const romBuffer = await readFile(romPath)
  const romBytes = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
  const inventory = await readRomInventory(new File([romBuffer], path.basename(romPath)))
  const landDataArchive = inventory.files.find((entry) => entry.path === '/a/0/6/5')
  const fieldModelArchive = inventory.files.find((entry) => entry.path === '/fielddata/build_model/bm_field.narc')
  if (!landDataArchive || !fieldModelArchive) throw new Error('Required archives are missing.')

  const inspectIds = [0, 1, 5, 6, 11, 12, 13, 14, 111, 112, 113, 114]
  const result = Object.fromEntries(inspectIds.map((modelId) => {
    const member = landDataArchive.archiveMembers[modelId]
    if (!member) return [modelId, { missing: true }]
    return [modelId, inspectMember(romBytes, member.offset, member.size, fieldModelArchive.archiveMembers.length)]
  }))

  console.log(JSON.stringify(result, null, 2))
}

await main()
