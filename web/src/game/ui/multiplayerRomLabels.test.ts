import { describe, expect, it } from 'vitest'
import { resolveMultiplayerRomLabels } from './multiplayerRomLabels'

const banks = (values: Readonly<{
  multiplayer: string
  play: string
  friends: string
  requests: string
  session: string
  trade: string
  account: string
  back: string
  close: string
}>) => ({
  19: { 45: values.multiplayer },
  45: { 8: values.close },
  191: { 23: values.trade, 156: values.requests, 282: values.friends, 336: values.play },
  196: { 21: values.back },
  282: { 5: values.account },
  442: { 3: values.session },
})

describe('libellés ROM du menu multijoueur', () => {
  it('résout les concepts proches depuis une ROM française', () => {
    expect(resolveMultiplayerRomLabels(banks({
      multiplayer: 'Multi avec un ami',
      play: 'A: COMMENCER',
      friends: 'AMI',
      requests: 'ENREGISTRER UN AMI?',
      session: 'CONNEXION AVEC UN RANGER',
      trade: 'ECHANGE',
      account: 'DRESSEUR',
      back: 'RETOUR',
      close: 'FERMER',
    }))).toEqual({
      multiplayer: 'Multi avec un ami',
      play: 'COMMENCER',
      friends: 'AMI',
      requests: 'ENREGISTRER UN AMI',
      session: 'CONNEXION',
      trade: 'ECHANGE',
      account: 'DRESSEUR',
      back: 'RETOUR',
      close: 'FERMER',
    })
  })

  it('utilise les mêmes coordonnées pour une ROM anglaise', () => {
    expect(resolveMultiplayerRomLabels(banks({
      multiplayer: 'Multi with a friend',
      play: 'A: START',
      friends: 'FRIEND',
      requests: 'REGISTER A FRIEND?',
      session: 'CONNECT WITH A RANGER',
      trade: 'TRADE',
      account: 'TRAINER',
      back: 'BACK',
      close: 'CLOSE',
    }))).toMatchObject({
      multiplayer: 'Multi with a friend',
      play: 'START',
      friends: 'FRIEND',
      requests: 'REGISTER A FRIEND',
      session: 'CONNECT',
      trade: 'TRADE',
      account: 'TRAINER',
      back: 'BACK',
      close: 'CLOSE',
    })
  })

  it('garde un repli produit lisible quand une coordonnée ROM manque', () => {
    expect(resolveMultiplayerRomLabels(undefined)).toEqual({
      multiplayer: 'Multijoueur',
      play: 'Jouer',
      friends: 'Amis',
      requests: 'Demandes',
      session: 'Session',
      trade: 'Échange',
      account: 'Compte',
      back: 'Retour',
      close: 'Fermer',
    })
  })
})
