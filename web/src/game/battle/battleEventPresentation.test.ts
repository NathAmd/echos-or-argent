import { describe, expect, it } from 'vitest'
import { collectBattleMoveDamageEvents } from './battleEventPresentation'

type TestEvent =
  | { kind: 'move', presentationId: number }
  | { kind: 'condition', condition: string }
  | { kind: 'miss' }
  | { kind: 'damage', target: number, movePresentationId?: number }

describe('collectBattleMoveDamageEvents', () => {
  it('conserve tous les dégâts directs d’une capacité de zone malgré les conditions intercalées', () => {
    const move = { kind: 'move', presentationId: 7 } as const
    const events: TestEvent[] = [
      move,
      { kind: 'condition', condition: 'resistBerry' },
      { kind: 'damage', target: 0, movePresentationId: 7 },
      { kind: 'condition', condition: 'substitute' },
      { kind: 'damage', target: 1, movePresentationId: 7 },
      { kind: 'condition', condition: 'ability:123' },
      { kind: 'damage', target: 1 },
    ]

    expect(collectBattleMoveDamageEvents(events, move)).toEqual([
      { kind: 'damage', target: 0, movePresentationId: 7 },
      { kind: 'damage', target: 1, movePresentationId: 7 },
    ])
  })

  it('ne rattache jamais un dégât résiduel à une capacité sans impact direct', () => {
    const move = { kind: 'move', presentationId: 8 } as const
    const events: TestEvent[] = [
      move,
      { kind: 'miss' },
      { kind: 'condition', condition: 'ability:123' },
      { kind: 'damage', target: 0 },
    ]

    expect(collectBattleMoveDamageEvents(events, move)).toEqual([])
  })
})
