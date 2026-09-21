export type IntroRenderState = {
  mode: 'dialog' | 'tutorial-choice' | 'gender-select' | 'gender-confirm' | 'name-input' | 'name-confirm'
  text: string
  speakerName?: string
  presentation?: 'dialog' | 'fullscreen'
  tutorialLayout?: number
  scene?: 'text' | 'tutorial' | 'oak' | 'oak-shifted' | 'oak-marill' | 'oak-returning' | 'profile'
  messageId?: number
  showGenderSelect: boolean
  selectedGender?: 'male' | 'female'
  choices?: string[]
  selectedChoice?: number
  playerName?: string
  nameInput?: {
    value: string
    maxLength: number
  }
}
