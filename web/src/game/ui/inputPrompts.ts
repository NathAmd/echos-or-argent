import { gameKeyboardBackPrompt } from '../../gameInput'

export type InputPromptProfile = 'keyboard' | 'mouse' | 'touch' | 'xbox' | 'playstation' | 'nintendo' | 'gamepad'

export type InputPromptLabels = {
  confirm: string
  cancel: string
  secondary: string
  menu: string
  'page-previous': string
  'page-next': string
}

const promptLabels: Readonly<Record<InputPromptProfile, InputPromptLabels>> = {
  keyboard: { confirm: '↵', cancel: gameKeyboardBackPrompt, secondary: 'X', menu: 'M', 'page-previous': 'Pg↑', 'page-next': 'Pg↓' },
  mouse: { confirm: 'Clic', cancel: gameKeyboardBackPrompt, secondary: 'Clic', menu: 'M', 'page-previous': '‹', 'page-next': '›' },
  touch: { confirm: '●', cancel: '↩', secondary: '●', menu: '≡', 'page-previous': '‹', 'page-next': '›' },
  xbox: { confirm: 'A', cancel: 'B', secondary: 'X', menu: 'Y', 'page-previous': 'LB', 'page-next': 'RB' },
  playstation: { confirm: '×', cancel: '○', secondary: '□', menu: '△', 'page-previous': 'L1', 'page-next': 'R1' },
  nintendo: { confirm: 'B', cancel: 'A', secondary: 'Y', menu: 'X', 'page-previous': 'L', 'page-next': 'R' },
  gamepad: { confirm: '1', cancel: '2', secondary: '3', menu: '4', 'page-previous': '5', 'page-next': '6' },
}

export function classifyGamepadInput(id: string): InputPromptProfile {
  const normalized = id.toLowerCase()
  if (/playstation|dualshock|dualsense|sony|054c/.test(normalized)) return 'playstation'
  if (/nintendo|switch|joy-con|057e/.test(normalized)) return 'nintendo'
  if (/xbox|xinput|microsoft|steam|valve|045e/.test(normalized)) return 'xbox'
  return 'gamepad'
}

export function getInputPromptLabels(profile: InputPromptProfile): InputPromptLabels {
  return promptLabels[profile]
}
