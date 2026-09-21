import type { HgssTrainer } from './trainerData'
import { readArm9OverlayFromRom } from '../arm9Overlay'

export const hgssPrizeMoneyEntryCount = 0x81

export type HgssPrizeMoneyEntry = {
  trainerClass: number
  multiplier: number
}

const tableSignature = new Uint8Array([
  0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x04, 0x00,
  0x03, 0x00, 0x04, 0x00,
])

function findSignature(bytes: Uint8Array, signature: Uint8Array): number {
  outer: for (let offset = 0; offset <= bytes.byteLength - signature.byteLength; offset += 2) {
    for (let index = 0; index < signature.byteLength; index += 1) {
      if (bytes[offset + index] !== signature[index]) continue outer
    }
    return offset
  }
  return -1
}

/**
 * Décode sPrizeMoneyTbl depuis l'overlay 12. La recherche par signature est
 * volontaire : les révisions/localisations HGSS décalent son adresse de lien.
 */
export function decodeHgssPrizeMoneyTableFromOverlay(overlay: Uint8Array): HgssPrizeMoneyEntry[] {
  const offset = findSignature(overlay, tableSignature)
  const byteLength = hgssPrizeMoneyEntryCount * 4
  if (offset < 0 || offset + byteLength > overlay.byteLength) {
    throw new Error("La table ROM HGSS des gains de Dresseurs est absente ou tronquée.")
  }
  const view = new DataView(overlay.buffer, overlay.byteOffset + offset, byteLength)
  const entries = Array.from({ length: hgssPrizeMoneyEntryCount }, (_, index): HgssPrizeMoneyEntry => ({
    trainerClass: view.getUint16(index * 4, true),
    multiplier: view.getUint16(index * 4 + 2, true),
  }))
  if (new Set(entries.map(({ trainerClass }) => trainerClass)).size !== entries.length) {
    throw new Error('La table ROM HGSS des gains contient des classes de Dresseurs dupliquées.')
  }
  return entries
}

export function decodeHgssPrizeMoneyTable(rom: Uint8Array): HgssPrizeMoneyEntry[] {
  return decodeHgssPrizeMoneyTableFromOverlay(readArm9OverlayFromRom(rom, 12))
}

export function calculateHgssTrainerPrizeMoney(
  trainer: HgssTrainer,
  table: readonly HgssPrizeMoneyEntry[],
  options: { ordinaryDouble?: boolean, prizeMoneyValue?: number } = {},
): number {
  const level = trainer.party.at(-1)?.level ?? 0
  const fallbackMultiplier = table.find(({ trainerClass }) => trainerClass === 2)?.multiplier ?? 4
  const multiplier = table.find(({ trainerClass }) => trainerClass === trainer.trainerClass)?.multiplier ?? fallbackMultiplier
  return level * 4 * multiplier * (options.prizeMoneyValue ?? 1) * (options.ordinaryDouble ? 2 : 1)
}

/** Jackpot est multiplié puis plafonné séparément à 65 535 ₽ par le moteur HGSS. */
export function calculateHgssPayDayPayout(payDayCoins: number, prizeMoneyValue = 1): number {
  return Math.min(0xffff, Math.max(0, Math.floor(payDayCoins)) * Math.max(1, Math.floor(prizeMoneyValue)))
}

export function calculateHgssMoneyLoss(
  party: readonly { level: number }[],
  badgeCount: number,
  currentMoney: number,
): number {
  const badgePenalty = [2, 4, 6, 9, 12, 16, 20, 25, 30][Math.max(0, Math.min(8, badgeCount))]!
  const maxLevel = party.reduce((highest, pokemon) => Math.max(highest, pokemon.level), 0)
  return Math.min(currentMoney, maxLevel * 4 * badgePenalty)
}
