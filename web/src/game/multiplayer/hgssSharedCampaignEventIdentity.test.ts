import { describe, expect, it } from 'vitest'
import {
  createHgssSharedCampaignFieldEventId,
  HgssSharedCampaignFieldEventIdentityError,
  parseHgssSharedCampaignFieldEventId,
  parseHgssSharedCampaignFieldEventIdentity,
  type HgssSharedCampaignFieldEventIdentity,
} from './hgssSharedCampaignEventIdentity'

const objectIdentity = Object.freeze({
  rom: Object.freeze({ gameCode: 'IPKE', gameVersion: 7, language: 2 }),
  mapId: 61,
  source: Object.freeze({ kind: 'object' as const, objectId: 7 }),
  scriptId: 3003,
})

const coordinateIdentity = Object.freeze({
  rom: Object.freeze({ gameCode: 'IPKF', gameVersion: 8, language: 3 }),
  mapId: 0xffff,
  source: Object.freeze({ kind: 'coordinate' as const, x: -1_000_000, z: 1_000_000 }),
  scriptId: 0xffff,
})

describe("identité d'événement terrain partagé HGSS", () => {
  it("construit puis décode exactement les formes objet et coordonnée", () => {
    const objectId = createHgssSharedCampaignFieldEventId(objectIdentity)
    const coordinateId = createHgssSharedCampaignFieldEventId(coordinateIdentity)

    expect(objectId).toBe('field-event.1.IPKE.7.2.1p.o.7.2bf')
    expect(coordinateId).toBe('field-event.1.IPKF.8.3.1ekf.c.16v7j.16v7k.1ekf')
    expect(parseHgssSharedCampaignFieldEventId(objectId)).toEqual(objectIdentity)
    expect(parseHgssSharedCampaignFieldEventId(coordinateId)).toEqual(coordinateIdentity)
    expect(Object.isFrozen(parseHgssSharedCampaignFieldEventId(objectId))).toBe(true)
    expect(Object.isFrozen(parseHgssSharedCampaignFieldEventId(objectId)?.rom)).toBe(true)
    expect(Object.isFrozen(parseHgssSharedCampaignFieldEventId(objectId)?.source)).toBe(true)
    for (const eventId of [objectId, coordinateId]) {
      expect(eventId.length).toBeLessThanOrEqual(128)
      expect(eventId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
      expect(eventId.startsWith('field-event.')).toBe(true)
    }
  })

  it("reste injectif pour chaque dimension ROM, carte, source et script", () => {
    const variants: HgssSharedCampaignFieldEventIdentity[] = [
      objectIdentity,
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameCode: 'IPKF' } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameVersion: 8 } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, language: 3 } },
      { ...objectIdentity, mapId: 62 },
      { ...objectIdentity, source: { kind: 'object', objectId: 8 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: 7, z: 0 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: 0, z: 7 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: -1, z: 1 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: 1, z: -1 } },
      { ...objectIdentity, scriptId: 3004 },
    ]
    const ids = variants.map(createHgssSharedCampaignFieldEventId)

    expect(new Set(ids).size).toBe(variants.length)
    expect(ids.map(parseHgssSharedCampaignFieldEventId)).toEqual(variants)
  })

  it("refuse les altérations et toutes les représentations non canoniques", () => {
    const canonical = createHgssSharedCampaignFieldEventId(objectIdentity)
    const invalid = [
      canonical.replace('field-event.1.', 'field-event.2.'),
      canonical.replace('.IPKE.', '.ipke.'),
      canonical.replace('.1p.', '.01p.'),
      canonical.replace('.2bf', '.02bf'),
      canonical.replace('.o.', '.O.'),
      `${canonical}.extra`,
      canonical.replace('.o.7.', '.o.'),
      canonical.replace('field-event.', 'field_event.'),
      canonical.replace('IPKE', 'IPKÉ'),
      `${canonical}${'a'.repeat(128)}`,
    ]

    for (const eventId of invalid) expect(parseHgssSharedCampaignFieldEventId(eventId)).toBeUndefined()
  })

  it("applique les bornes réelles aux identifiants et coordonnées", () => {
    const accepted = [
      { ...objectIdentity, rom: { gameCode: '0000', gameVersion: 0, language: 0 }, mapId: 0, source: { kind: 'object' as const, objectId: 0 }, scriptId: 1 },
      { ...objectIdentity, rom: { gameCode: 'ZZZZ', gameVersion: 0xff, language: 0xff }, mapId: 0xffff, source: { kind: 'object' as const, objectId: 0xffff }, scriptId: 0xffff },
      { ...objectIdentity, source: { kind: 'coordinate' as const, x: -1_000_000, z: 1_000_000 } },
    ]
    for (const identity of accepted) {
      const eventId = createHgssSharedCampaignFieldEventId(identity)
      expect(parseHgssSharedCampaignFieldEventId(eventId)).toEqual(identity)
    }

    const invalid = [
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameVersion: 256 } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, language: -1 } },
      { ...objectIdentity, mapId: 0x1_0000 },
      { ...objectIdentity, source: { kind: 'object', objectId: -1 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: -1_000_001, z: 0 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: 0, z: 1_000_001 } },
      { ...objectIdentity, scriptId: 0 },
      { ...objectIdentity, scriptId: 0x1_0000 },
      { ...objectIdentity, mapId: -0 },
    ]
    for (const identity of invalid) {
      expect(() => createHgssSharedCampaignFieldEventId(identity))
        .toThrowError(HgssSharedCampaignFieldEventIdentityError)
    }
  })

  it("exige des objets de données aux clés et descripteurs exacts", () => {
    class ForgedIdentity {
      rom = objectIdentity.rom
      mapId = objectIdentity.mapId
      source = objectIdentity.source
      scriptId = objectIdentity.scriptId
    }
    const accessor = {
      ...objectIdentity,
      get scriptId() { return 3003 },
    }
    const withSymbol = {
      ...objectIdentity,
      [Symbol('tamper')]: true,
    }
    const malformed = [
      { ...objectIdentity, extra: true },
      { ...objectIdentity, rom: { ...objectIdentity.rom, extra: true } },
      { ...objectIdentity, source: { ...objectIdentity.source, x: 1 } },
      new ForgedIdentity(),
      accessor,
      withSymbol,
    ]
    for (const identity of malformed) {
      expect(parseHgssSharedCampaignFieldEventIdentity(identity)).toBeUndefined()
      expect(() => createHgssSharedCampaignFieldEventId(identity))
        .toThrowError(HgssSharedCampaignFieldEventIdentityError)
    }

    const nullPrototype = Object.assign(Object.create(null), objectIdentity)
    expect(parseHgssSharedCampaignFieldEventIdentity(nullPrototype)).toEqual(objectIdentity)
  })

  it("refuse de corriger silencieusement le code ROM ou les nombres", () => {
    const invalid = [
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameCode: 'ipke' } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameCode: 'IPKÉ' } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameCode: 'IPKE ' } },
      { ...objectIdentity, rom: { ...objectIdentity.rom, gameVersion: 7.1 } },
      { ...objectIdentity, source: { kind: 'coordinate', x: -0, z: 1 } },
    ]
    for (const identity of invalid) {
      expect(parseHgssSharedCampaignFieldEventIdentity(identity)).toBeUndefined()
    }
  })
})
