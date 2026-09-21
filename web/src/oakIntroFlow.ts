import type { IntroRenderState } from './game/intro/introTypes'
import {
  clampChoice,
  getChoiceLabel,
  getGenderPrompt,
  getMessage,
  getTimeOfDayIntroMessageId,
  playerNameMaxLength,
  profileIntroMessages,
  sanitizeNameCharacter,
  splitDialogPages,
  tutorialAdventureMessages,
  tutorialControlsMessages,
  tutorialDialogMessages,
} from './game/intro/oakIntroContent'

export type OakIntroFlow = {
  getRenderState: () => IntroRenderState
  advance: () => 'running' | 'complete'
  chooseGender: (gender: 'male' | 'female') => 'running' | 'complete'
  setGenderCursor: (gender: 'male' | 'female') => void
  moveGenderCursor: (direction: -1 | 1) => void
  setChoiceCursor: (index: number) => void
  moveChoiceCursor: (direction: -1 | 1) => void
  chooseCurrentSelection: (choiceIndex?: number) => 'running' | 'complete'
  setPlayerName: (value: string) => void
}

type IntroPhase =
  | { kind: 'dialog', messageIds: number[], messageIndex: number, next: IntroNextPhase }
  | { kind: 'tutorial-choice' }
  | { kind: 'tutorial-confirm' }
  | { kind: 'gender-select' }
  | { kind: 'gender-confirm' }
  | { kind: 'name-input' }
  | { kind: 'name-confirm' }

type IntroNextPhase = 'tutorial-choice' | 'tutorial-confirm' | 'gender-select' | 'name-input' | 'complete'

export function createOakIntroFlow(messages: Record<number, string> | undefined): OakIntroFlow {
  let phase: IntroPhase = {
    kind: 'dialog',
    // The ROM opens on its tutorial menu. Oak only appears after "No info".
    messageIds: [7],
    messageIndex: 0,
    next: 'tutorial-choice',
  }
  let pageIndex = 0
  let selectedGender: 'male' | 'female' = 'male'
  let selectedChoice = 0
  let playerName = ''

  function beginDialog(messageIds: number[], next: IntroNextPhase): void {
    phase = { kind: 'dialog', messageIds, messageIndex: 0, next }
    pageIndex = 0
  }

  function enterNextPhase(next: IntroNextPhase): 'running' | 'complete' {
    pageIndex = 0
    if (next === 'complete') return 'complete'
    if (next === 'tutorial-choice') {
      phase = { kind: 'tutorial-choice' }
      selectedChoice = 0
      return 'running'
    }
    if (next === 'tutorial-confirm') {
      phase = { kind: 'tutorial-confirm' }
      selectedChoice = 0
      return 'running'
    }
    if (next === 'gender-select') {
      phase = { kind: 'gender-select' }
      return 'running'
    }
    phase = { kind: 'name-input' }
    return 'running'
  }

  function getDialogPages(): string[] {
    if (phase.kind !== 'dialog') return ['']
    const messageId = phase.messageIds[Math.min(phase.messageIndex, phase.messageIds.length - 1)]
    return splitDialogPages(getMessage(messages, messageId), playerName)
  }

  function getConfirmationChoices(): string[] {
    return [getChoiceLabel(messages, 47), getChoiceLabel(messages, 48)]
  }

  function getRenderState(): IntroRenderState {
    if (phase.kind === 'dialog') {
      const pages = getDialogPages()
      const messageId = phase.messageIds[Math.min(phase.messageIndex, phase.messageIds.length - 1)]
      return {
        mode: 'dialog',
        text: pages[Math.min(pageIndex, pages.length - 1)] ?? '',
        speakerName: messageId >= 6 && messageId !== 7 ? 'Prof. Chen' : undefined,
        messageId,
        presentation: messageId === 7
          || tutorialAdventureMessages.includes(messageId)
          || (tutorialControlsMessages.includes(messageId) && !tutorialDialogMessages.includes(messageId))
          ? 'fullscreen'
          : 'dialog',
        tutorialLayout: tutorialAdventureMessages.includes(messageId) ? 5
          : messageId === 14 ? 2
            : messageId === 16 ? 3
              : messageId === 17 ? 4
                : messageId === 7 || tutorialControlsMessages.includes(messageId) ? 1 : 0,
        scene: messageId >= 1 && messageId <= 5
          ? 'text'
          : messageId === 7 || tutorialControlsMessages.includes(messageId) || tutorialAdventureMessages.includes(messageId)
            ? 'tutorial'
            : messageId === 35
              ? 'oak-marill'
              : messageId === 36
                ? 'oak-returning'
              : messageId === 34
                ? 'oak-shifted'
                : profileIntroMessages.includes(messageId) || messageId === 6 || (messageId >= 40 && messageId <= 43)
                  ? 'oak'
                : 'profile',
        showGenderSelect: false,
        selectedGender,
        playerName,
      }
    }
    if (phase.kind === 'tutorial-choice') {
      return {
        mode: 'tutorial-choice',
        text: '',
        showGenderSelect: false,
        selectedGender,
        choices: [44, 45, 46].map((messageId) => getChoiceLabel(messages, messageId)),
        selectedChoice,
        tutorialLayout: 1,
        playerName,
      }
    }
    if (phase.kind === 'tutorial-confirm') {
      return {
        mode: 'tutorial-choice',
        text: '',
        showGenderSelect: false,
        selectedGender,
        choices: [61, 62].map((messageId) => getChoiceLabel(messages, messageId)),
        selectedChoice,
        tutorialLayout: 1,
        playerName,
      }
    }
    if (phase.kind === 'gender-select') {
      return {
        mode: 'gender-select',
        text: getGenderPrompt(messages, playerName),
        speakerName: 'Prof. Chen',
        showGenderSelect: true,
        selectedGender,
        playerName,
      }
    }
    if (phase.kind === 'gender-confirm') {
      const messageId = selectedGender === 'male' ? 38 : 39
      return {
        mode: 'gender-confirm',
        text: splitDialogPages(getMessage(messages, messageId), playerName)[0] ?? '',
        speakerName: 'Prof. Chen',
        showGenderSelect: true,
        selectedGender,
        choices: getConfirmationChoices(),
        selectedChoice,
        playerName,
      }
    }
    if (phase.kind === 'name-input') {
      return {
        mode: 'name-input',
        text: getMessage(messages, 40),
        showGenderSelect: false,
        selectedGender,
        playerName,
        nameInput: {
          value: playerName,
          maxLength: playerNameMaxLength,
        },
      }
    }

    const messageId = selectedGender === 'male' ? 41 : 42
    return {
      mode: 'name-confirm',
      text: splitDialogPages(getMessage(messages, messageId), playerName)[0] ?? '',
      speakerName: 'Prof. Chen',
      scene: 'oak',
      showGenderSelect: false,
      selectedGender,
      choices: getConfirmationChoices(),
      selectedChoice,
      playerName,
    }
  }

  function continueDialog(): 'running' | 'complete' {
    if (phase.kind !== 'dialog') return 'running'
    const pages = getDialogPages()
    if (pageIndex + 1 < pages.length) {
      pageIndex += 1
      return 'running'
    }
    if (phase.messageIndex + 1 < phase.messageIds.length) {
      phase = { ...phase, messageIndex: phase.messageIndex + 1 }
      pageIndex = 0
      return 'running'
    }
    return enterNextPhase(phase.next)
  }

  function chooseCurrentSelection(choiceIndex = selectedChoice): 'running' | 'complete' {
    if (phase.kind === 'tutorial-choice') {
      const selected = clampChoice(choiceIndex, 3)
      selectedChoice = selected
      if (selected === 0) beginDialog(tutorialControlsMessages, 'tutorial-confirm')
      else if (selected === 1) beginDialog(tutorialAdventureMessages, 'tutorial-choice')
      else beginDialog([getTimeOfDayIntroMessageId(), 6, ...profileIntroMessages], 'gender-select')
      return 'running'
    }
    if (phase.kind === 'tutorial-confirm') {
      const selected = clampChoice(choiceIndex, 2)
      selectedChoice = selected
      if (selected === 0) enterNextPhase('tutorial-choice')
      else beginDialog(tutorialControlsMessages, 'tutorial-confirm')
      return 'running'
    }
    if (phase.kind === 'gender-confirm') {
      const selected = clampChoice(choiceIndex, 2)
      selectedChoice = selected
      if (selected === 0) {
        beginDialog([40], 'name-input')
      } else {
        phase = { kind: 'gender-select' }
        pageIndex = 0
      }
      return 'running'
    }
    if (phase.kind === 'name-confirm') {
      const selected = clampChoice(choiceIndex, 2)
      selectedChoice = selected
      if (selected === 0) {
        beginDialog([43], 'complete')
      } else {
        // The native state re-enters the gender question after a rejected
        // name, through CONFIRM_GENDER_NO_WAIT_FADE_OUT.
        phase = { kind: 'gender-select' }
        pageIndex = 0
      }
      return 'running'
    }
    return advance()
  }

  function advance(): 'running' | 'complete' {
    if (phase.kind === 'dialog') return continueDialog()
    if (phase.kind === 'tutorial-choice' || phase.kind === 'tutorial-confirm' || phase.kind === 'gender-confirm' || phase.kind === 'name-confirm') {
      return chooseCurrentSelection()
    }
    if (phase.kind === 'gender-select') {
      phase = { kind: 'gender-confirm' }
      selectedChoice = 0
      pageIndex = 0
      return 'running'
    }
    if (phase.kind === 'name-input') {
      if (playerName.length === 0) return 'running'
      phase = { kind: 'name-confirm' }
      selectedChoice = 0
      pageIndex = 0
    }
    return 'running'
  }

  function chooseGender(gender: 'male' | 'female'): 'running' | 'complete' {
    selectedGender = gender
    if (phase.kind === 'gender-select') {
      phase = { kind: 'gender-confirm' }
      selectedChoice = 0
      pageIndex = 0
    }
    return 'running'
  }

  function moveGenderCursor(direction: -1 | 1): void {
    if (phase.kind !== 'gender-select' && phase.kind !== 'gender-confirm') return
    selectedGender = direction < 0 ? 'male' : 'female'
  }

  function setGenderCursor(gender: 'male' | 'female'): void {
    if (phase.kind !== 'gender-select' && phase.kind !== 'gender-confirm') return
    selectedGender = gender
  }

  function setChoiceCursor(index: number): void {
    if (phase.kind === 'tutorial-choice') selectedChoice = clampChoice(index, 3)
    if (phase.kind === 'tutorial-confirm') selectedChoice = clampChoice(index, 2)
    if (phase.kind === 'gender-confirm' || phase.kind === 'name-confirm') selectedChoice = clampChoice(index, 2)
  }

  function moveChoiceCursor(direction: -1 | 1): void {
    if (phase.kind === 'tutorial-choice') {
      selectedChoice = (selectedChoice + direction + 3) % 3
      return
    }
    if (phase.kind === 'tutorial-confirm') {
      selectedChoice = (selectedChoice + direction + 2) % 2
      return
    }
    if (phase.kind === 'gender-confirm' || phase.kind === 'name-confirm') {
      selectedChoice = (selectedChoice + direction + 2) % 2
    }
  }

  function setPlayerName(value: string): void {
    if (phase.kind !== 'name-input') return
    playerName = Array.from(value)
      .map((character) => sanitizeNameCharacter(character) ?? '')
      .join('')
      .slice(0, playerNameMaxLength)
  }

  return {
    getRenderState,
    advance,
    chooseGender,
    setGenderCursor,
    moveGenderCursor,
    setChoiceCursor,
    moveChoiceCursor,
    chooseCurrentSelection,
    setPlayerName,
  }
}
