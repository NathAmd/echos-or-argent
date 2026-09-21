import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NarcMember } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'

const latinAccentChars = 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿŒœŞşªº¹²³'
const messagePunctuation = new Map<number, string>([
  [0x01a8, '$'], [0x01a9, '¡'], [0x01aa, '¿'], [0x01ab, '!'], [0x01ac, '?'],
  [0x01ad, ','], [0x01ae, '.'], [0x01af, '…'], [0x01b0, '·'], [0x01b1, '/'],
  [0x01b2, '‘'], [0x01b3, '’'], [0x01b4, '“'], [0x01b5, '”'], [0x01b9, '('],
  [0x01ba, ')'], [0x01bb, '♂'], [0x01bc, '♀'], [0x01bd, '+'], [0x01be, '-'],
  [0x01bf, '*'], [0x01c0, '#'], [0x01c1, '='], [0x01c2, '&'], [0x01c3, '~'],
  [0x01c4, ':'], [0x01c5, ';'], [0x01d0, '@'], [0x01d2, '%'], [0x01de, ' '],
  [0x25bc, '\r'], [0x25bd, '\f'], [0xe000, '\n'],
])

function decodeMessageCharacter(code: number): string {
  if (code >= 0x0121 && code <= 0x012a) return String.fromCharCode('0'.charCodeAt(0) + code - 0x0121)
  if (code >= 0x012b && code <= 0x0144) return String.fromCharCode('A'.charCodeAt(0) + code - 0x012b)
  if (code >= 0x0145 && code <= 0x015e) return String.fromCharCode('a'.charCodeAt(0) + code - 0x0145)
  if (code >= 0x015f && code < 0x015f + latinAccentChars.length) return latinAccentChars[code - 0x015f]
  return messagePunctuation.get(code) ?? ''
}

function normalizeMessageSpacing(message: string): string {
  return message
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]+\r/g, '\r')
    .replace(/[ \t]+\f/g, '\f')
    // 25BC/25BD sont des attentes de printer, pas des espaces décoratifs.
    .replace(/^[ \t\n]+|[ \t\n]+$/g, '')
}

export function stripMessageControls(message: string): string {
  return normalizeMessageSpacing(message)
    .replace(/\{[^}]*\}/g, '')
    .trim()
}

export function decodeHgssMessageBank(bytes: Uint8Array, member: NarcMember | undefined): Record<number, string> | undefined {
  if (!member) return undefined
  const compressed = bytes.slice(member.offset, member.offset + member.size)
  const payload = decompressLz10(compressed) ?? compressed
  if (payload.byteLength < 4) return undefined

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const count = readUint16(view, 0)
  const key = readUint16(view, 2)
  if (count === 0 || 4 + count * 8 > payload.byteLength) return undefined

  const messages: Record<number, string> = {}
  for (let messageIndex = 0; messageIndex < count; messageIndex += 1) {
    const allocKeyLow = (765 * (messageIndex + 1) * key) & 0xffff
    const allocKey = (allocKeyLow | (allocKeyLow << 16)) >>> 0
    const offset = (readUint32(view, 4 + messageIndex * 8) ^ allocKey) >>> 0
    const length = (readUint32(view, 8 + messageIndex * 8) ^ allocKey) >>> 0
    if (offset + length * 2 > payload.byteLength) continue

    let seed = ((messageIndex + 1) * 596947) & 0xffff
    let decoded = ''
    for (let wordIndex = 0; wordIndex < length; wordIndex += 1) {
      const encrypted = readUint16(view, offset + wordIndex * 2)
      const code = encrypted ^ seed
      seed = (seed + 18749) & 0xffff
      if (code === 0xffff) break
      if (code === 0xfffe) {
        if (wordIndex + 2 >= length) break
        const command = readUint16(view, offset + (wordIndex + 1) * 2) ^ seed
        seed = (seed + 18749) & 0xffff
        const argCount = readUint16(view, offset + (wordIndex + 2) * 2) ^ seed
        seed = (seed + 18749) & 0xffff
        const args: number[] = []
        wordIndex += 2
        for (let argIndex = 0; argIndex < argCount && wordIndex + 1 < length; argIndex += 1) {
          wordIndex += 1
          args.push(readUint16(view, offset + wordIndex * 2) ^ seed)
          seed = (seed + 18749) & 0xffff
        }
        decoded += `{${command.toString(16)}${args.length ? ` ${args.join(',')}` : ''}}`
        continue
      }
      decoded += decodeMessageCharacter(code)
    }
    messages[messageIndex] = normalizeMessageSpacing(decoded)
  }
  return messages
}
