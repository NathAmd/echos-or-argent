import { describe, expect, it } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import {
  createFieldRecordAppsHost,
  type FieldRecordAppsRunnerPort,
  type FieldRecordAppsStep,
} from './fieldRecordAppsHost'

type TestListener = EventListenerOrEventListenerObject

class TestElement {
  hidden = true
  textContent = ''
  className = ''
  readonly dataset: Record<string, string> = {}
  children: TestElement[] = []
  closeButton?: TestElement
  private readonly listeners = new Map<string, Set<TestListener>>()

  append(...children: TestElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: TestElement[]): void {
    this.children = children
  }

  querySelector<T extends Element>(): T | null {
    return (this.closeButton ?? null) as unknown as T | null
  }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  click(): void {
    const event = { target: this } as unknown as Event
    for (const listener of this.listeners.get('click') ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

function digital(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'keyboard' }
}

function createFixture() {
  const pokeathlon = new TestElement()
  const frontierRecords = new TestElement()
  pokeathlon.closeButton = new TestElement()
  frontierRecords.closeButton = new TestElement()
  const elements = {
    pokeathlon,
    pokeathlonTitle: new TestElement(),
    pokeathlonContent: new TestElement(),
    frontierRecords,
    frontierRecordsTitle: new TestElement(),
    frontierRecordsView: new TestElement(),
    frontierRecordsContent: new TestElement(),
  }
  const calls: string[] = []
  const gameClears: boolean[] = []
  let runnerAvailable = true
  const runner: FieldRecordAppsRunnerPort = {
    closePokeathlonApp: () => { calls.push('close-pokeathlon') },
    closeFrontierRecordsApp: () => { calls.push('close-frontier') },
    closeGameClear: () => { calls.push('close-game-clear') },
  }
  const host = createFieldRecordAppsHost(
    elements as unknown as Parameters<typeof createFieldRecordAppsHost>[0],
    {
      createElement: () => new TestElement() as unknown as HTMLElement,
      readRom: () => ({ pokeathlonDataMessages: { 4: 'Course ROM' } }),
      readRunner: () => runnerAvailable ? runner : undefined,
      onAdvance: () => { calls.push(`advance:${String(pokeathlon.hidden && frontierRecords.hidden)}`) },
      onGameClear: (firstClear: boolean) => { gameClears.push(firstClear) },
    } as unknown as Parameters<typeof createFieldRecordAppsHost>[1],
  )
  return {
    ...elements,
    host,
    calls,
    gameClears,
    setRunnerAvailable: (available: boolean) => { runnerAvailable = available },
  }
}

describe('host des applications de records terrain', () => {
  it('rend le Pokéathlon avec les libellés de données ROM et reprend le runner après fermeture', () => {
    const fixture = createFixture()
    fixture.host.open({
      kind: 'pokeathlonApp',
      app: 'courseRecords',
      records: [12, 70_000],
      athletePoints: 1_234,
    })

    expect(fixture.host.getOpenApp()).toBe('pokeathlon')
    expect(fixture.pokeathlon.hidden).toBe(false)
    expect(fixture.pokeathlonTitle.textContent).toBe('Records des parcours')
    const [points, records] = fixture.pokeathlonContent.children
    expect(points?.textContent).toContain('1')
    expect(records?.children[0]?.children.map(({ textContent }) => textContent)).toEqual(['Course ROM', '12'])
    expect(records?.children[1]?.children.map(({ textContent }) => textContent)).toEqual(['Record 02', '65535'])

    expect(fixture.host.handleDigital(digital('right'))).toBe(true)
    expect(fixture.calls).toEqual([])
    expect(fixture.host.handleDigital(digital('confirm'))).toBe(true)
    expect(fixture.calls).toEqual(['close-pokeathlon', 'advance:true'])
    expect(fixture.pokeathlonContent.children).toEqual([])
  })

  it('rend Frontier, conserve les tons et ne ferme pas sans runner', () => {
    const fixture = createFixture()
    const step: FieldRecordAppsStep = {
      kind: 'frontierRecordsApp',
      page: {
        facility: 'hall',
        facilityId: 5,
        title: 'Scène de Combat',
        view: 'single',
        viewLabel: 'Simple',
        subject: 'Typhlosion',
        rows: [{ label: 'Record', value: 1_234, tone: 'record' }],
      },
    }
    fixture.host.open(step)

    expect(fixture.frontierRecords.dataset).toMatchObject({ scriptApp: 'frontier-records', facility: 'hall' })
    expect(fixture.frontierRecordsView.textContent).toBe('Simple · Typhlosion')
    expect(fixture.frontierRecordsContent.children[0]?.children[0]?.dataset.tone).toBe('record')
    fixture.setRunnerAvailable(false)
    fixture.frontierRecords.closeButton?.click()
    expect(fixture.host.isOpen()).toBe(true)
    expect(fixture.calls).toEqual([])
  })

  it('distingue game-clear, notifie la campagne et détruit les écouteurs de pointeur', () => {
    const fixture = createFixture()
    fixture.host.open({
      kind: 'gameClear',
      defeatedRed: false,
      firstClear: true,
      page: {
        facility: 'tower',
        facilityId: 1,
        title: 'Panthéon',
        view: 'single',
        viewLabel: 'Équipe',
        rows: [],
      },
    })

    expect(fixture.host.getOpenApp()).toBe('game-clear')
    expect(fixture.gameClears).toEqual([true])
    fixture.frontierRecords.closeButton?.click()
    expect(fixture.calls).toEqual(['close-game-clear', 'advance:true'])

    fixture.host.open({ kind: 'pokeathlonApp', app: 'medals', records: [], athletePoints: 0 })
    fixture.host.destroy()
    fixture.pokeathlon.closeButton?.click()
    expect(fixture.calls).toEqual(['close-game-clear', 'advance:true'])
    expect(fixture.host.handleDigital(digital('confirm', false))).toBe(false)
  })
})
