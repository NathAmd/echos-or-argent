import { describe, expect, it } from 'vitest'
import { createHgssFrontierRecordPage } from './hgssFrontierRecords'

describe('overlay de records Frontier HGSS', () => {
  it('reprend les stats Simple de la Tour de Combat', () => {
    const page = createHgssFrontierRecordPage(1, 0, 0, new Map([[1, 14], [0, 49]]))

    expect(page).toMatchObject({ facility: 'tower', title: 'Tour de Combat', view: 'single', viewLabel: 'Simple' })
    expect(page.rows.map(({ value }) => value)).toEqual([14, 49])
  })

  it('sépare les records Niveau 50 et Niveau libre de l’Usine', () => {
    const page = createHgssFrontierRecordPage(2, 1, 0, new Map([[0x13, 7], [0x15, 21], [0x17, 28]]))

    expect(page.rows).toHaveLength(8)
    expect(page.rows[0]).toMatchObject({ label: 'Niveau 50 · série précédente', value: 7 })
    expect(page.rows[4]).toMatchObject({ label: 'Niveau libre · série précédente', value: 28 })
  })

  it('n’affiche le record de la Scène que pour l’espèce mémorisée par la ROM', () => {
    const records = new Map([[0x24, 155], [0x23, 76]])
    expect(createHgssFrontierRecordPage(5, 0, 155, records, Array(156).fill('').map((_, index) => `P${index}`))).toMatchObject({
      subject: 'P155',
      rows: [{ value: 76 }],
    })
    expect(createHgssFrontierRecordPage(5, 0, 152, records).rows[0]?.value).toBe(0)
  })
})
