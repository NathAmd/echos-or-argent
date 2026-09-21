import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./appShell.ts', import.meta.url), 'utf8')

describe('contrat du shell applicatif', () => {
  it('conserve le label utilisé par le flux de surnom Safari', () => {
    expect(source).toMatch(
      /<form id="field-nickname"[\s\S]*?<label for="field-nickname-input"><\/label>[\s\S]*?<input id="field-nickname-input"/,
    )
  })
})
