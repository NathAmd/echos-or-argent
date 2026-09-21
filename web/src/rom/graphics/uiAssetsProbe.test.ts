import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import { decodeNitroGraphicPayload, decodeNitroTilemapGraphicPayload } from './nitro2d'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_UI_ROM_PROBE === '1' && existsSync(romPath) ? it : it.skip

function payload(rom: Uint8Array, archive: RomFile, memberIndex: number): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member) throw new Error(`${archive.path}[${memberIndex}] est absent.`)
  const packed = rom.subarray(member.offset, member.offset + member.size)
  return decompressLz10(packed) ?? packed
}

function dimensions(label: string, graphic: NitroGraphic | undefined) {
  return { label, dimensions: graphic ? `${graphic.width} × ${graphic.height}` : 'non décodé' }
}

async function writePam(path: string, graphic: NitroGraphic): Promise<void> {
  const header = `P7\nWIDTH ${graphic.width}\nHEIGHT ${graphic.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`
  await writeFile(path, Buffer.concat([Buffer.from(header), Buffer.from(graphic.pixels)]))
}

describe('HGSS UI asset inventory', () => {
  probe('lists named NitroFS candidates without guessing an archive role', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const candidates = inventory.files.filter((file) => (
      /menu|bag|poke|gear|tel|map|town|card|option|window|frame|icon|status|party|plist|pms|touch|mark|trainer/i.test(file.path)
    ))
    expect(candidates.length).toBeGreaterThan(0)
    console.table(candidates.map(({ path, size, archiveEntries }) => ({ path, size, archiveEntries })))
    for (const path of ['/pbr/bag_gra.narc', '/pbr/plist_gra.narc', '/pbr/poketch.narc', '/pbr/winframe.narc']) {
      const archive = inventory.files.find((file) => file.path === path)
      expect(archive, path).toBeDefined()
      console.log(path)
      console.table(archive?.archiveMembers.map(({ index, size, signature }) => {
        const decoded = payload(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), archive, index)
        return { index, size, signature, decodedSize: decoded.byteLength, decodedSignature: String.fromCharCode(...decoded.subarray(0, 4)) }
      }))
    }
    const rom = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const windows = inventory.files.find((file) => file.path === '/pbr/winframe.narc')!
    const windowGraphics = Array.from({ length: 22 }, (_, index) => decodeNitroGraphicPayload(
      payload(rom, windows, index), payload(rom, windows, index + 24),
    ))
    console.table(windowGraphics.map((graphic, index) => dimensions(`window-${index}`, graphic)))
    const bag = inventory.files.find((file) => file.path === '/pbr/bag_gra.narc')!
    const bagGraphics = [
      ['bag-main-0', decodeNitroTilemapGraphicPayload(payload(rom, bag, 7), payload(rom, bag, 8), payload(rom, bag, 9), false)],
      ['bag-main-1', decodeNitroTilemapGraphicPayload(payload(rom, bag, 7), payload(rom, bag, 8), payload(rom, bag, 10), false)],
      ['bag-panel', decodeNitroTilemapGraphicPayload(payload(rom, bag, 11), payload(rom, bag, 12), payload(rom, bag, 13), false)],
      ['bag-main-alt', decodeNitroTilemapGraphicPayload(payload(rom, bag, 34), payload(rom, bag, 35), payload(rom, bag, 36), false)],
    ] as const
    console.table(bagGraphics.map(([label, graphic]) => dimensions(label, graphic)))
    const previewDirectory = fileURLToPath(new URL('../../../.tmp-debug/ui-assets/', import.meta.url))
    await mkdir(previewDirectory, { recursive: true })
    for (const index of [0, 2, 8, 15, 21]) {
      const graphic = windowGraphics[index]
      if (graphic) await writePam(`${previewDirectory}/window-${index}.pam`, graphic)
    }
    for (const [label, graphic] of bagGraphics) if (graphic) await writePam(`${previewDirectory}/${label}.pam`, graphic)
  }, 20_000)
})
