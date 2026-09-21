import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { decodeAreaMapPropDomain } from './areaMapPropDomain'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip
const nativeCaveLadderUsages = [
  { mapId: 7, modelId: 67 }, // Tour Cendrée
  { mapId: 110, modelId: 66 }, // Tour Chétiflor
  { mapId: 107, modelId: 69 }, // Mont Sélénite
  { mapId: 120, modelId: 70 }, // Route de Glace
  { mapId: 125, modelId: 70 }, // Antre du Dragon
  { mapId: 220, modelId: 145 }, // Phare
  { mapId: 223, modelId: 144 }, // Phare
] as const
const nativeCaveLadderDomainKeys = new Set(['field:66', 'field:67', 'field:69', 'field:70', 'room:144', 'room:145'])

describe('HGSS cave MapProp ROM audit', () => {
  probe('keeps cave terrain separate from native ladder props and resolves their area domain', async () => {
    const romBuffer = await readFile(romPath)
    const romBytes = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const areaData = inventory.files.find((file) => file.path === '/a/0/4/2')
    expect(areaData).toBeTruthy()
    const embeddedPropSurfaces = inventory.resolvedMapCatalog.maps.flatMap((map) => {
      const count = map.model?.surfaces?.filter((surface) => surface.supportsMovement === false).length ?? 0
      return count > 0 ? [{ mapId: map.id, label: map.label, count }] : []
    })
    const unresolvedMapProps = inventory.resolvedMapCatalog.maps.flatMap((map) => (
      [...new Set(map.model?.mapProps?.map(({ modelId }) => modelId) ?? [])]
        .filter((modelId) => !inventory.mapPropModelResolver?.(modelId, map.header.areaDataBank))
        .map((modelId) => ({ mapId: map.id, label: map.label, modelId, areaDataBank: map.header.areaDataBank }))
    ))

    const result = inventory.resolvedMapCatalog.maps
      .filter((map) => map.header.mapType === 3 && (map.model?.mapProps?.length ?? 0) > 0)
      .map((map) => {
        const member = areaData!.archiveMembers[map.header.areaDataBank]!
        const domain = decodeAreaMapPropDomain(romBytes.subarray(member.offset, member.offset + member.size))
        return {
          mapId: map.id,
          label: map.label,
          areaDataBank: map.header.areaDataBank,
          domain,
          embeddedPropSurfaces: map.model?.surfaces?.filter((surface) => surface.supportsMovement === false).length ?? 0,
          unresolvedProps: [...new Set(map.model!.mapProps!.map(({ modelId }) => modelId))]
            .filter((modelId) => !inventory.mapPropModelResolver?.(modelId, map.header.areaDataBank, domain)),
        }
      })

    // Ces paires sont des usages natifs observés dans les land_data de la ROM,
    // pas des exceptions de rendu. Elles empêchent le probe de devenir vide si
    // le domaine résout à nouveau les mêmes IDs vers les étagères de bm_room.
    const missingNativeLadderUsages = nativeCaveLadderUsages.flatMap(({ mapId, modelId }) => {
      const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === mapId)
      return map?.header.mapType === 3 && map.model?.mapProps?.some((prop) => prop.modelId === modelId)
        ? []
        : [{ mapId, modelId, label: map?.label, mapType: map?.header.mapType }]
    })
    const nativeLadderAudit = inventory.resolvedMapCatalog.maps
      .filter((map) => map.header.mapType === 3)
      .flatMap((map) => {
        const member = areaData!.archiveMembers[map.header.areaDataBank]
        const domain = member ? decodeAreaMapPropDomain(romBytes.subarray(member.offset, member.offset + member.size)) : undefined
        return [...new Set(map.model?.mapProps?.map(({ modelId }) => modelId) ?? [])]
          .filter((modelId) => domain && nativeCaveLadderDomainKeys.has(`${domain}:${modelId}`))
          .map((modelId) => {
          const model = domain
            ? inventory.mapPropModelResolver?.(modelId, map.header.areaDataBank, domain)
            : undefined
          const misleadingDomain = domain === 'field' ? 'room' : 'field'
          const misleadingModel = inventory.mapPropModelResolver?.(modelId, map.header.areaDataBank, misleadingDomain)
          const materials = [...new Set(model?.surfaces?.flatMap((surface) => (
            [surface.materialName, surface.textureName]
              .filter((name): name is string => Boolean(name))
          )) ?? [])]
          const misleadingMaterials = [...new Set(misleadingModel?.surfaces?.flatMap((surface) => (
            [surface.materialName, surface.textureName].filter((name): name is string => Boolean(name))
          )) ?? [])]
          return { mapId: map.id, label: map.label, modelId, domain, materials, misleadingMaterials }
          })
      })
    const invalidNativeLadders = nativeLadderAudit.filter(({ domain, materials, misleadingMaterials }) => (
      !domain
      || !materials.some((name) => /stair|ladder|slope/i.test(name))
      || materials.some((name) => /shelf/i.test(name))
      || JSON.stringify(materials) !== JSON.stringify(misleadingMaterials)
    ))

    const animatedDomainExamples = (['field', 'room'] as const).map((domain) => result
      .filter((entry) => entry.domain === domain)
      .flatMap((entry) => {
        const map = inventory.resolvedMapCatalog.maps.find(({ id }) => id === entry.mapId)!
        return [...new Set(map.model?.mapProps?.map(({ modelId }) => modelId) ?? [])].flatMap((modelId) => {
          const metadata = inventory.mapPropAnimationMetadataResolver?.(modelId, domain, entry.areaDataBank)
          return metadata?.hasAnimations ? [{ map, modelId, domain, metadata }] : []
        })
      })[0])
    const animationDomainFailures: Array<Record<string, unknown>> = []
    for (const entry of animatedDomainExamples) {
      if (!entry) {
        animationDomainFailures.push({ reason: 'missing-domain-example' })
        continue
      }
      const misleadingDomain = entry.domain === 'field' ? 'room' : 'field'
      const misleadingMetadata = inventory.mapPropAnimationMetadataResolver?.(entry.modelId, misleadingDomain, entry.map.header.areaDataBank)
      const missingTracks = entry.metadata.animationArchiveIds.filter((archiveId) => (
        !inventory.mapPropAnimationResolver?.(entry.modelId, entry.map.header.areaDataBank, archiveId, misleadingDomain)?.frames.length
      ))
      if (JSON.stringify(misleadingMetadata) !== JSON.stringify(entry.metadata) || missingTracks.length > 0) {
        animationDomainFailures.push({ mapId: entry.map.id, modelId: entry.modelId, domain: entry.domain, misleadingMetadata, missingTracks })
      }
    }

    expect(result.length).toBeGreaterThan(0)
    expect(embeddedPropSurfaces).toEqual([])
    expect(unresolvedMapProps).toEqual([])
    expect(result.filter(({ domain }) => !domain)).toEqual([])
    expect(result.filter(({ unresolvedProps }) => unresolvedProps.length > 0)).toEqual([])
    expect(result.filter(({ embeddedPropSurfaces }) => embeddedPropSurfaces > 0)).toEqual([])
    expect(missingNativeLadderUsages).toEqual([])
    expect([...new Set(nativeLadderAudit.map(({ modelId }) => modelId))].sort((a, b) => a - b)).toEqual([66, 67, 69, 70, 144, 145])
    expect([...new Set(nativeLadderAudit.map(({ domain, modelId }) => `${domain}:${modelId}`))].sort()).toEqual([...nativeCaveLadderDomainKeys].sort())
    expect(nativeLadderAudit.length).toBeGreaterThanOrEqual(nativeCaveLadderUsages.length)
    expect(invalidNativeLadders).toEqual([])
    expect(animationDomainFailures).toEqual([])
  }, 120_000)
})
