export type FieldMessageBufferState = {
  buffers: ReadonlyMap<number, string>
}

export function formatFieldMessage(text: string, state: FieldMessageBufferState): string {
  return text.replace(/\{[^}]*\}/g, (control) => {
    const match = /^\{([0-9a-f]+)(?:\s+([^}]*))?\}$/i.exec(control)
    if (!match) throw new Error(`Controle de message HGSS mal forme: ${control}.`)
    const command = Number.parseInt(match[1]!, 16)
    const argumentsList = match[2]?.match(/\d+/g)?.map(Number) ?? []
    const commandFamily = command & 0xff00
    if (commandFamily === 0x0100 || commandFamily === 0x0300 || commandFamily === 0x0400 || commandFamily === 0x3400) {
      return state.buffers.get(argumentsList[0]!) ?? ''
    }
    if ((command >= 0x0200 && command <= 0x0208) || command === 0xff00 || command === 0xff01) return ''
    throw new Error(`Controle de message HGSS ${match[1]} non pris en charge.`)
  }).trim()
}
