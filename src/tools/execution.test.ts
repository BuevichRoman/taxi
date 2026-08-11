/**
 * Правила перерывов (ТЗ-001, разделы 3-5 контракта).
 *
 * Раньше эти правила проверялись на мок-сервере, но считает их клиент:
 * бэкенд перерывы не пересчитывает и не проверяет, для него это просто
 * сохранённый JSON. Проверки переехали туда же, куда и расчёт.
 */

import {
  BREAK_ERRORS,
  MIN_VISIBLE_BREAK_DURATION_FALLBACK,
  ROUNDING_UNIT_SECONDS_FALLBACK,
  applyBreakAction,
  breakActionError,
  buildActual,
  finishExecution,
  minVisibleBreakDuration,
  roundSeconds,
  roundingUnitSeconds,
  totalsFrom,
} from './execution'
import { ICarExecution } from '../types/types'

/** Момент времени в формате проекта, отсчёт от начала работы */
const at = (minutes: number): string => {
  const base = Date.UTC(2026, 7, 10, 10, 0, 0) + minutes * 60_000
  const d = new Date(base)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  )
}

const dateAt = (minutes: number): Date => new Date(Date.parse(at(minutes)))

const started = at(0)

describe('Показатели без перерывов', () => {
  it('рабочее время равно общему', () => {
    const totals = totalsFrom(started, dateAt(60).getTime(), [])

    expect(totals.total_seconds).toBe(3600)
    expect(totals.work_seconds).toBe(3600)
    expect(totals.break_seconds).toBe(0)
    expect(totals.billable_work_seconds).toBe(3600)
  })

  it('до начала работы всё по нулям', () => {
    expect(totalsFrom(null, dateAt(60).getTime(), [])).toEqual({
      total_seconds: 0,
      work_seconds: 0,
      break_seconds: 0,
      billable_work_seconds: 0,
    })
  })
})

describe('Показатели с перерывами', () => {
  it('перерыв вычитается из рабочего времени', () => {
    const breaks = [{ id: '1', started: at(20), ended: at(35), display: true }]
    const totals = totalsFrom(started, dateAt(60).getTime(), breaks)

    expect(totals.total_seconds).toBe(3600)
    expect(totals.break_seconds).toBe(900)
    expect(totals.work_seconds).toBe(2700)
  })

  it('незакрытый перерыв считается до текущего момента', () => {
    const breaks = [{ id: '1', started: at(50), ended: null, display: true }]
    const totals = totalsFrom(started, dateAt(60).getTime(), breaks)

    expect(totals.break_seconds).toBe(600)
    expect(totals.work_seconds).toBe(3000)
  })

  it('несколько перерывов складываются', () => {
    const breaks = [
      { id: '1', started: at(10), ended: at(20), display: true },
      { id: '2', started: at(30), ended: at(45), display: true },
    ]

    expect(totalsFrom(started, dateAt(60).getTime(), breaks).break_seconds).toBe(1500)
  })
})

describe('Округление оплачиваемого времени (п. 11.1)', () => {
  it('вверх до целой минуты', () => {
    expect(roundSeconds(1)).toBe(60)
    expect(roundSeconds(61)).toBe(120)
  })

  it('целые минуты не трогает', () => {
    expect(roundSeconds(120)).toBe(120)
    expect(roundSeconds(0)).toBe(0)
  })
})

describe('Короткие перерывы (п. 20)', () => {
  it('завершённый короче минуты скрывается, но из времени вычитается', () => {
    const breaks = [{ id: '1', started: at(10), ended: at(10.5), display: true }]
    const actual = buildActual(started, null, breaks, dateAt(60))

    expect(actual.breaks[0].display).toBe(false)
    expect(actual.break_seconds).toBe(30)
    expect(MIN_VISIBLE_BREAK_DURATION_FALLBACK).toBe(60)
  })

  it('активный показывается всегда', () => {
    const breaks = [{ id: '1', started: at(59.9), ended: null, display: false }]

    expect(buildActual(started, null, breaks, dateAt(60)).breaks[0].display).toBe(true)
  })
})

describe('Параметры из конфигурации тенанта (п. 11.1, п. 20)', () => {
  /** Конфиг тенанта так и лежит в window.data — его приносит отдельный скрипт */
  const setConstants = (values?: Record<string, string>) => {
    (window as any).data = values ?
      {
        site_constants: Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, { value }]),
        ),
      } :
      undefined
  }

  afterEach(() => setConstants())

  it('без конфига работают запасные значения', () => {
    expect(minVisibleBreakDuration()).toBe(MIN_VISIBLE_BREAK_DURATION_FALLBACK)
    expect(roundingUnitSeconds()).toBe(ROUNDING_UNIT_SECONDS_FALLBACK)
  })

  it('значения берутся из site_constants', () => {
    setConstants({
      min_visible_break_duration: '120',
      break_rounding_unit_seconds: '300',
    })

    expect(minVisibleBreakDuration()).toBe(120)
    expect(roundingUnitSeconds()).toBe(300)
    expect(roundSeconds(1)).toBe(300)
  })

  it('перерыв скрывается по значению из конфига, а не по зашитой минуте', () => {
    setConstants({ min_visible_break_duration: '120' })
    const breaks = [{ id: '1', started: at(10), ended: at(11), display: true }]

    expect(buildActual(started, null, breaks, dateAt(60)).breaks[0].display)
      .toBe(false)
  })

  it('негодное значение константы не ломает расчёт', () => {
    setConstants({
      min_visible_break_duration: 'нет',
      break_rounding_unit_seconds: '0',
    })

    expect(minVisibleBreakDuration()).toBe(MIN_VISIBLE_BREAK_DURATION_FALLBACK)
    expect(roundingUnitSeconds()).toBe(ROUNDING_UNIT_SECONDS_FALLBACK)
  })
})

describe('Переходы режима', () => {
  const work: ICarExecution = {
    schema_version: 1,
    mode: 'work',
    actual: buildActual(started, null, [], dateAt(30)),
  }

  it('начало перерыва открывает интервал и включает режим', () => {
    const next = applyBreakAction(work, true, started, dateAt(30))

    expect(next.mode).toBe('break')
    expect(next.actual.breaks).toHaveLength(1)
    expect(next.actual.breaks[0].ended).toBeNull()
  })

  it('окончание закрывает интервал и возвращает работу', () => {
    const onBreak = applyBreakAction(work, true, started, dateAt(30))
    const next = applyBreakAction(onBreak, false, started, dateAt(45))

    expect(next.mode).toBe('work')
    expect(next.actual.breaks[0].ended).not.toBeNull()
    expect(next.actual.break_seconds).toBe(900)
  })

  it('момент начала работы не теряется между правками', () => {
    const next = applyBreakAction(work, true, null, dateAt(30))

    expect(next.actual.started).toBe(started)
  })

  it('первый перерыв на пустом блоке заводит его сам', () => {
    const next = applyBreakAction(null, true, started, dateAt(30))

    expect(next.actual.started).toBe(started)
    expect(next.actual.breaks).toHaveLength(1)
  })
})

describe('Недопустимые переходы (п. 14, 22)', () => {
  const withMode = (mode: 'work' | 'break' | null, ended: string | null = null) => ({
    mode,
    actual: { ...buildActual(started, ended, [], dateAt(60)) },
  })

  it('второй перерыв поверх идущего не открыть', () => {
    expect(breakActionError(withMode('break'), true)).toBe(BREAK_ERRORS.alreadyActive)
  })

  it('завершить перерыв, когда его нет, нельзя', () => {
    expect(breakActionError(withMode('work'), false)).toBe(BREAK_ERRORS.notActive)
  })

  it('у завершённого заказа не начать перерыв', () => {
    expect(breakActionError(withMode(null, at(60)), true)).toBe(BREAK_ERRORS.orderFinished)
  })

  it('допустимые переходы проходят', () => {
    expect(breakActionError(withMode('work'), true)).toBeNull()
    expect(breakActionError(withMode('break'), false)).toBeNull()
  })

  it('до начала работы блок пуст — начать перерыв можно', () => {
    expect(breakActionError(null, true)).toBeNull()
  })
})

describe('Завершение заказа (п. 12, 17)', () => {
  it('во время перерыва интервал закрывается временем завершения', () => {
    const onBreak = applyBreakAction(null, true, started, dateAt(40))
    const finished = finishExecution(onBreak, started, dateAt(60))

    expect(finished.mode).toBeNull()
    expect(finished.actual.ended).not.toBeNull()
    expect(finished.actual.breaks[0].ended).toBe(finished.actual.ended)
    expect(finished.actual.break_seconds).toBe(1200)
    expect(finished.actual.work_seconds).toBe(2400)
  })

  it('после завершения показатели больше не растут', () => {
    const finished = finishExecution(null, started, dateAt(60))
    const later = buildActual(
      finished.actual.started,
      finished.actual.ended,
      finished.actual.breaks,
      dateAt(600),
    )

    expect(later.total_seconds).toBe(finished.actual.total_seconds)
  })
})
