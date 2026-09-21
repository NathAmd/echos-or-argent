import { describe, expect, it } from 'vitest'
import { createUnifiedPcEntryCoordinator, resolveUnifiedPcEntryChoice } from './pcBoxLegacyEntry'

const messages = {
  67: 'DEPOSER\nPOKéMON',
  68: 'RETIRER\nPOKéMON',
  69: 'DEPLACER\nPOKéMON',
  70: 'DEPLACER\nOBJETS',
}

describe('entrée unifiée des Boîtes PC', () => {
  it('saute le sous-menu des anciens modes via la branche Déplacer de la ROM', () => {
    expect(resolveUnifiedPcEntryChoice([
      { label: 'DEPOSER\nPOKéMON', value: 0 },
      { label: 'RETIRER\nPOKéMON', value: 1 },
      { label: 'DEPLACER\nPOKéMON', value: 2 },
      { label: 'DEPLACER\nOBJETS', value: 3 },
      { label: 'SALUT!', value: 4 },
    ], messages)).toBe(2)
  })

  it('ne détourne pas un autre dialogue qui contient un libellé PC isolé', () => {
    expect(resolveUnifiedPcEntryChoice([
      { label: 'DEPLACER\nPOKéMON', value: 7 },
      { label: 'ANNULER', value: 0xfffe },
    ], messages)).toBeUndefined()
  })

  it('déroule SALUT puis DECONNEXION après la fermeture de l’application', () => {
    const service = [
      { label: 'DEPOSER\nPOKéMON', value: 0 }, { label: 'RETIRER\nPOKéMON', value: 1 },
      { label: 'DEPLACER\nPOKéMON', value: 2 }, { label: 'DEPLACER\nOBJETS', value: 3 },
      { label: 'SALUT!', value: 5 },
    ]
    const terminal = [
      { label: 'PC DE ???', value: 0 }, { label: 'PC DE JO', value: 1 }, { label: 'DECONNEXION', value: 2 },
    ]
    const coordinator = createUnifiedPcEntryCoordinator()

    expect(coordinator.resolveChoice(service, messages)).toBe(2)
    coordinator.applicationClosed()
    expect(coordinator.isUnwinding()).toBe(true)
    expect(coordinator.resolveChoice(service, messages)).toBe(5)
    expect(coordinator.resolveChoice(terminal, messages)).toBe(2)
    expect(coordinator.isUnwinding()).toBe(false)
  })

  it('ne consomme pas un choix étranger pendant la sortie du terminal', () => {
    const coordinator = createUnifiedPcEntryCoordinator()
    coordinator.applicationClosed()
    expect(coordinator.resolveChoice([{ label: 'OUI', value: 0 }, { label: 'NON', value: 1 }], messages)).toBeUndefined()
    expect(coordinator.isUnwinding()).toBe(true)
    coordinator.reset()
    expect(coordinator.isUnwinding()).toBe(false)
  })
})
