import type { AdaptiveViewport } from '../../rendering/canvas/adaptiveViewport'

export type LayoutRect = { x: number, y: number, width: number, height: number }

export const confirmationChoiceGap = 8

export type ResponsiveIntroLayout = {
  dialog: LayoutRect
  dialogText: LayoutRect
  confirmationChoices: LayoutRect
  tutorialChoices: LayoutRect
  genderMale: LayoutRect
  genderFemale: LayoutRect
  namePanel: LayoutRect
  nameEntry: LayoutRect
}

export function getResponsiveIntroLayout(viewport: AdaptiveViewport, hasDialogChoices = false): ResponsiveIntroLayout {
  const margin = 28
  const dialog = { x: margin, y: viewport.height - 102, width: viewport.width - margin * 2, height: 78 }
  const confirmationChoiceWidth = 72
  const confirmationChoicesWidth = confirmationChoiceWidth * 2 + confirmationChoiceGap
  const confirmationChoices = {
    x: dialog.x + dialog.width - confirmationChoicesWidth - 20,
    y: dialog.y + 25,
    width: confirmationChoiceWidth,
    height: 28,
  }
  const dialogText = {
    x: dialog.x + 20,
    y: dialog.y + 20,
    width: dialog.width - (hasDialogChoices ? confirmationChoicesWidth + 80 : 40),
    height: 48,
  }
  const tutorialWidth = Math.min(420, viewport.width - 48)
  const genderGap = 28
  const genderWidth = 158
  const genderGroupWidth = genderWidth * 2 + genderGap
  const genderX = Math.round((viewport.width - genderGroupWidth) / 2)
  const namePanelWidth = Math.min(480, viewport.width - 48)
  const namePanel = { x: Math.round((viewport.width - namePanelWidth) / 2), y: 24, width: namePanelWidth, height: 126 }

  return {
    dialog,
    dialogText,
    confirmationChoices,
    tutorialChoices: { x: Math.round((viewport.width - tutorialWidth) / 2), y: Math.max(60, dialog.y - 180), width: tutorialWidth, height: 42 },
    genderMale: { x: genderX, y: Math.max(36, dialog.y - 224), width: genderWidth, height: 210 },
    genderFemale: { x: genderX + genderWidth + genderGap, y: Math.max(36, dialog.y - 224), width: genderWidth, height: 210 },
    namePanel,
    nameEntry: { x: namePanel.x + 22, y: namePanel.y + 66, width: namePanel.width - 112, height: 40 },
  }
}
