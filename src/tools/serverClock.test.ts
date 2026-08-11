/**
 * Часы сервера (ТЗ п. 4).
 *
 * Проверяется разбор заголовка и смещение. Сам перехватчик ответов не
 * проверяется отдельно: он ничего не решает и только передаёт заголовок
 * в `syncFromHttpDate`.
 */

import {
  resetServerClock,
  serverNow,
  serverOffsetMs,
  syncFromHttpDate,
} from './serverClock'

/** Заголовок Date для момента, отстоящего от часов устройства на shiftMs */
const httpDate = (shiftMs: number): string =>
  new Date(Date.now() + shiftMs).toUTCString()

/** Заголовок хранит целые секунды, отсюда допуск */
const SECOND = 1000

beforeEach(() => resetServerClock())

describe('Смещение часов', () => {
  it('без ответов время равно часам устройства', () => {
    expect(serverOffsetMs()).toBe(0)
    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(SECOND)
  })

  it('часы устройства отстают — время идёт от серверного', () => {
    syncFromHttpDate(httpDate(120_000))

    expect(serverOffsetMs()).toBeGreaterThan(120_000 - SECOND)
    expect(serverNow().getTime() - Date.now())
      .toBeGreaterThan(120_000 - SECOND)
  })

  it('часы устройства спешат — время отматывается назад', () => {
    syncFromHttpDate(httpDate(-300_000))

    expect(serverOffsetMs()).toBeLessThan(-300_000 + SECOND)
    expect(Date.now() - serverNow().getTime())
      .toBeGreaterThan(300_000 - SECOND)
  })

  it('каждый следующий ответ уточняет смещение', () => {
    syncFromHttpDate(httpDate(120_000))
    syncFromHttpDate(httpDate(0))

    expect(Math.abs(serverOffsetMs())).toBeLessThan(SECOND)
  })
})

describe('Негодный заголовок', () => {
  it('пустого заголовка нет — смещение не трогаем', () => {
    syncFromHttpDate(httpDate(120_000))
    const before = serverOffsetMs()

    syncFromHttpDate(undefined)
    syncFromHttpDate(null)
    syncFromHttpDate('')

    expect(serverOffsetMs()).toBe(before)
  })

  it('неразбираемое значение не сбивает часы', () => {
    syncFromHttpDate(httpDate(120_000))
    const before = serverOffsetMs()

    syncFromHttpDate('вчера вечером')

    expect(serverOffsetMs()).toBe(before)
  })
})
