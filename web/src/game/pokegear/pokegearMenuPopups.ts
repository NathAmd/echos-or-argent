import type { ChoicePopupController } from '../ui/choicePopupController'
import type { PokegearPhoneSort } from './pokegearNativeState'

export function openPokegearContactPopup(options: {
  popup: ChoicePopupController
  contactName: string
  phoneMessages: Record<number, string>
  onCall: () => void
  onSort: (sort: PokegearPhoneSort) => void
}): void {
  const openSort = () => openPokegearSortPopup(options.popup, options.onSort, options.phoneMessages)
  options.popup.open<'call' | 'sort' | 'quit'>({
    title: options.contactName,
    message: options.phoneMessages[20] ?? '',
    options: [{ value: 'call', label: options.phoneMessages[0] ?? '' }, { value: 'sort', label: options.phoneMessages[1] ?? '' }, { value: 'quit', label: options.phoneMessages[2] ?? '' }],
    cancelIndex: 2,
    onSelect: (choice) => { if (choice === 'call') options.onCall(); else if (choice === 'sort') openSort() },
  })
}

export function openPokegearSortPopup(popup: ChoicePopupController, onSort: (sort: PokegearPhoneSort) => void, phoneMessages: Record<number, string>): void {
  popup.open<PokegearPhoneSort | 'quit'>({
    title: phoneMessages[1] ?? '',
    message: phoneMessages[20] ?? '',
    options: [
      { value: 'trainer', label: phoneMessages[3] ?? '' },
      { value: 'alphabet', label: phoneMessages[4] ?? '' },
      { value: 'location', label: phoneMessages[5] ?? '' },
      { value: 'manual', label: phoneMessages[6] ?? '' },
      { value: 'quit', label: phoneMessages[7] ?? '' },
    ],
    cancelIndex: 4,
    onSelect: (choice) => { if (choice !== 'quit') onSort(choice) },
  })
}

export function openPokegearSkinConfirmation(popup: ChoicePopupController, themeName: string, onApply: () => void, configureMessages: Record<number, string>): void {
  popup.open<'apply' | 'cancel'>({
    title: themeName,
    message: '',
    options: [{ value: 'apply', label: configureMessages[0] ?? '' }, { value: 'cancel', label: configureMessages[1] ?? '' }],
    initialIndex: 1,
    cancelIndex: 1,
    onSelect: (choice) => { if (choice === 'apply') onApply() },
  })
}
