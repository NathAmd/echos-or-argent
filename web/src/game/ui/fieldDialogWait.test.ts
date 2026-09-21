import { describe, expect, it } from 'vitest'
import { getAcknowledgedDialogWaitAction } from './fieldDialogWait'

describe('field dialog waits', () => {
  it('permet de passer les attentes sans état visuel restant bloqué', () => {
    expect(getAcknowledgedDialogWaitAction('timer')).toBe('advance')
    expect(getAcknowledgedDialogWaitAction('fanfare')).toBe('advance')
    expect(getAcknowledgedDialogWaitAction('cry')).toBe('advance')
  })

  it('masque le texte confirmé pendant les animations qui doivent finir', () => {
    expect(getAcknowledgedDialogWaitAction('movement')).toBe('dismiss')
    expect(getAcknowledgedDialogWaitAction('doorAnimation')).toBe('dismiss')
    expect(getAcknowledgedDialogWaitAction('music')).toBe('dismiss')
  })

  it('ne détourne pas les validations encore attendues par le script', () => {
    expect(getAcknowledgedDialogWaitAction('input')).toBe('ignore')
    expect(getAcknowledgedDialogWaitAction('followerReaction')).toBe('ignore')
  })
})
