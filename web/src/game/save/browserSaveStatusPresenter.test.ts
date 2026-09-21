import { describe, expect, it } from 'vitest'
import { createBrowserSaveStatusPresenter } from './browserSaveStatusPresenter'

describe('présentation des erreurs de sauvegarde navigateur', () => {
  it('conserve une erreur visible jusqu’à la prochaine sauvegarde réussie', () => {
    const element = {
      dataset: {} as Record<string, string>,
      hidden: false,
      textContent: 'ancien statut',
    }
    const presenter = createBrowserSaveStatusPresenter(element as unknown as HTMLElement)

    expect(element).toMatchObject({ hidden: true, textContent: '', dataset: {} })

    presenter.reportError('Sauvegarde impossible : stockage plein')
    expect(element).toMatchObject({
      hidden: false,
      textContent: 'Sauvegarde impossible : stockage plein',
      dataset: { saveError: 'true' },
    })

    presenter.clearError()
    expect(element).toMatchObject({ hidden: true, textContent: '', dataset: {} })
  })
})