import type { NarcMember } from '../../ndsTypes'

export type AreaMapPropDomain = 'field' | 'room'

export function decodeAreaMapPropDomain(areaData: Uint8Array): AreaMapPropDomain | undefined {
  if (areaData.length < 7) return undefined
  return areaData[6] === 0 ? 'room' : 'field'
}

export function resolveAreaMapPropDomain(rom: Uint8Array, member: NarcMember | undefined): AreaMapPropDomain | undefined {
  return member && decodeAreaMapPropDomain(rom.subarray(member.offset, member.offset + member.size))
}

export function orderAreaMapPropDomains(preferred: AreaMapPropDomain): readonly AreaMapPropDomain[] {
  return preferred === 'field' ? ['field', 'room'] : ['room', 'field']
}

export function resolveAreaMapPropDomains(rom: Uint8Array, member: NarcMember | undefined, fallback: AreaMapPropDomain): readonly AreaMapPropDomain[] {
  const nativeDomain = resolveAreaMapPropDomain(rom, member)
  return nativeDomain ? [nativeDomain] : orderAreaMapPropDomains(fallback)
}
