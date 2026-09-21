import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NitroAnimationPreview, RomFile } from '../../ndsTypes'
import { hasNitroMagic, readNitroDictionary, type NitroResourceView } from './nitroResource'

/** Lit uniquement les métadonnées communes des conteneurs BCA/BTP/BTA/BMA. */
export function decodeNitroAnimationPreview(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number,
  kind: NitroAnimationPreview['kind'],
): NitroAnimationPreview | undefined {
  const member = archive?.archiveMembers[memberIndex]
  if (!archive || !member || member.size < 0x20 || !hasNitroMagic(bytes, member.offset, `${kind}0`)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const fileSize = readUint32(view, 8)
  const headerSize = readUint16(view, 12)
  const sectionCount = readUint16(view, 14)
  if (fileSize > member.size || headerSize !== 16 || sectionCount === 0 || 16 + sectionCount * 4 > fileSize) return undefined
  const resource: NitroResourceView = { bytes, view, baseOffset: member.offset, fileSize }

  for (let section = 0; section < sectionCount; section += 1) {
    const sectionOffset = readUint32(view, 16 + section * 4)
    if (sectionOffset + 16 > fileSize) continue
    const entries = readNitroDictionary(resource, sectionOffset + 8, (elementOffset) => readUint32(view, elementOffset))
    if (entries.length === 0) continue
    const animationOffset = sectionOffset + entries[0]!.value
    if (animationOffset + 8 > fileSize) continue
    const frameCount = readUint16(view, animationOffset + 4)
    if (frameCount === 0 || frameCount > 4096) continue
    const rawTrackCount = kind === 'BCA'
      ? readUint16(view, animationOffset + 6)
      : view.getUint8(animationOffset + 6)
    return {
      kind,
      sourcePath: archive.path,
      sourceMemberIndex: memberIndex,
      name: entries[0]!.name || undefined,
      frameCount,
      trackCount: rawTrackCount > 0 ? rawTrackCount : undefined,
    }
  }
  return undefined
}
