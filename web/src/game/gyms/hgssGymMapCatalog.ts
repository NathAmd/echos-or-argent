export const hgssGymMapCatalog = [
  { badgeIndex: 0, gymMapIds: [135], badgeAwardMapId: 135 },
  { badgeIndex: 1, gymMapIds: [180], badgeAwardMapId: 180 },
  { badgeIndex: 2, gymMapIds: [137], badgeAwardMapId: 137 },
  { badgeIndex: 3, gymMapIds: [80], badgeAwardMapId: 80 },
  { badgeIndex: 4, gymMapIds: [139], badgeAwardMapId: 139 },
  { badgeIndex: 5, gymMapIds: [138], badgeAwardMapId: 138 },
  { badgeIndex: 6, gymMapIds: [397, 396, 140], badgeAwardMapId: 140 },
  { badgeIndex: 7, gymMapIds: [141], badgeAwardMapId: 288 },
  { badgeIndex: 8, gymMapIds: [473], badgeAwardMapId: 473 },
  { badgeIndex: 9, gymMapIds: [427], badgeAwardMapId: 427 },
  { badgeIndex: 10, gymMapIds: [365], badgeAwardMapId: 365 },
  { badgeIndex: 11, gymMapIds: [395], badgeAwardMapId: 395 },
  { badgeIndex: 12, gymMapIds: [480], badgeAwardMapId: 480 },
  { badgeIndex: 13, gymMapIds: [410], badgeAwardMapId: 410 },
  { badgeIndex: 14, gymMapIds: [457], badgeAwardMapId: 457 },
  { badgeIndex: 15, gymMapIds: [496], badgeAwardMapId: 496 },
] as const

export const hgssAllGymMapIds = hgssGymMapCatalog.flatMap(({ gymMapIds }) => [...gymMapIds])
export const hgssBadgeAwardMapIds = hgssGymMapCatalog.map(({ badgeAwardMapId }) => badgeAwardMapId)
