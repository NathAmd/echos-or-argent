import { describe, expect, it, vi } from 'vitest'
import { createFieldTextEntryCoordinator } from './fieldTextEntryCoordinator'
import type { GameTextEntryOverlay, GameTextEntryRequest } from './gameTextEntryOverlay'

function createFixture() {
  let request: GameTextEntryRequest | undefined
  const cancelButton = { hidden: false, disabled: false }
  const count = { textContent: '' }
  const root = {
    querySelector: (selector: string) => selector === '[data-nickname-cancel]' ? cancelButton : count,
  } as unknown as HTMLElement
  const nicknameInput = {
    value: 'PIKA', maxLength: 10,
    getAttribute: (name: string) => name === 'aria-label' ? 'Nom du Pokémon' : null,
  } as unknown as HTMLInputElement
  const numberInput = {
    value: '2', min: '1', max: '99', step: '1',
    getAttribute: (name: string) => name === 'aria-label' ? 'Quantité' : null,
  } as unknown as HTMLInputElement
  const textEntry: GameTextEntryOverlay = {
    open: (next) => { request = next },
    close: vi.fn(), submitCurrent: vi.fn(() => true), refresh: vi.fn(), isOpen: () => false,
    handle: () => false, handleKeyboard: () => false, destroy: vi.fn(),
  }
  const submitNickname = vi.fn()
  const submitNumber = vi.fn()
  const coordinator = createFieldTextEntryCoordinator({
    nicknameRoot: root, nicknameInput, numberInput, textEntry, submitNickname, submitNumber,
  })
  return {
    coordinator, cancelButton, count, nicknameInput, numberInput, submitNickname, submitNumber,
    request: () => request, textEntry,
  }
}

describe('coordinateur des saisies terrain', () => {
  it('délègue le surnom obligatoire au clavier central et garde le compteur synchronisé', () => {
    const fixture = createFixture()
    fixture.coordinator.setNicknameCancellable(false)
    fixture.coordinator.openNickname()
    const request = fixture.request()

    expect(fixture.cancelButton).toEqual({ hidden: true, disabled: true })
    expect(request).toMatchObject({ mode: 'name', title: 'Nom du Pokémon', maxLength: 10, cancellable: false })
    request?.write('LUGIA')
    expect(fixture.nicknameInput.value).toBe('LUGIA')
    expect(fixture.count.textContent).toBe('5/10')
    request?.cancel()
    expect(fixture.submitNickname).not.toHaveBeenCalled()
    request?.submit('LUGIA')
    expect(fixture.submitNickname).toHaveBeenCalledWith('LUGIA')
  })

  it('porte les bornes et la validation numérique vers le même clavier', () => {
    const fixture = createFixture()
    fixture.coordinator.openNumber()
    const request = fixture.request()

    expect(request).toMatchObject({ mode: 'number', title: 'Quantité', min: 1, max: 99, step: 1 })
    request?.write('12')
    expect(fixture.numberInput.value).toBe('12')
    request?.submit('12')
    expect(fixture.submitNumber).toHaveBeenCalledWith(12)
    request?.cancel()
    expect(fixture.submitNumber).toHaveBeenCalledWith(undefined)
  })

  it('termine les saisies du bot par le clavier central au lieu de laisser son modal ouvert', () => {
    const fixture = createFixture()
    fixture.coordinator.setNicknameCancellable(false)
    fixture.textEntry.isOpen = () => true

    expect(fixture.coordinator.completeNicknameForAutomation()).toBe(true)
    expect(fixture.textEntry.submitCurrent).toHaveBeenCalledOnce()
    expect(fixture.submitNickname).not.toHaveBeenCalled()

    expect(fixture.coordinator.completeNumberForAutomation()).toBe(true)
    expect(fixture.textEntry.submitCurrent).toHaveBeenCalledTimes(2)
  })
})
