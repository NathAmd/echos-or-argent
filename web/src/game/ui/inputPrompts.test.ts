import { describe, expect, it } from 'vitest'
import { classifyGamepadInput, getInputPromptLabels } from './inputPrompts'

describe('input prompts', () => {
  it.each([
    ['Xbox Wireless Controller', 'xbox'],
    ['Sony DualSense Wireless Controller (054c)', 'playstation'],
    ['Nintendo Switch Pro Controller (057e)', 'nintendo'],
    ['8BitDo Ultimate Controller', 'gamepad'],
  ] as const)('classifie %s sans inventer une disposition incompatible', (id, expected) => {
    expect(classifyGamepadInput(id)).toBe(expected)
  })

  it('respecte l’inversion physique confirmer/retour des manettes Nintendo', () => {
    expect(getInputPromptLabels('nintendo')).toMatchObject({ confirm: 'B', cancel: 'A', secondary: 'Y', menu: 'X' })
    expect(getInputPromptLabels('keyboard')).toMatchObject({ confirm: '↵', cancel: 'Esc / ⇧', secondary: 'X', menu: 'M' })
    expect(getInputPromptLabels('mouse')).toMatchObject({ confirm: 'Clic', cancel: 'Esc / ⇧' })
    expect(getInputPromptLabels('touch')).toMatchObject({ confirm: '●', cancel: '↩', menu: '≡' })
  })
})
