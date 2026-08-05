/**
 * Сведение плана и факта (ТЗ пп. 3, 6, 9).
 *
 * План и факт лежат в разных местах и пишутся разными людьми: план — в
 * `b_options` заказом, факт — в `c_options` няни. Экранам нужны оба сразу.
 */

import { getExecution } from './order'
import { ICarExecution, IOrder } from '../types/types'

const estimate = {
  started: '2026-08-10 09:00:00+03:00',
  ended: '2026-08-10 15:00:00+03:00',
  breaks: [{ started: '2026-08-10 11:00:00+03:00', ended: '2026-08-10 12:00:00+03:00' }],
  total_seconds: 21600,
  work_seconds: 18000,
  break_seconds: 3600,
  billable_work_seconds: 18000,
}

const carried: ICarExecution = {
  schema_version: 1,
  mode: 'break',
  actual: {
    started: '2026-08-10 09:04:00+03:00',
    ended: null,
    breaks: [
      {
        id: '1-1',
        started: '2026-08-10 11:10:00+03:00',
        ended: null,
        display: true,
      },
    ],
    total_seconds: 7560,
    work_seconds: 7000,
    break_seconds: 560,
    billable_work_seconds: 7020,
  },
}

const orderWith = (
  options?: Record<string, unknown>,
  drivers?: unknown[],
): IOrder => ({ b_options: options, drivers } as unknown as IOrder)

describe('getExecution', () => {
  it('сводит план из b_options и факт из c_options', () => {
    const merged = getExecution(
      orderWith(
        { b_execution: { schema_version: 1, estimate } },
        [{ u_id: 'nanny-1', c_options: { c_execution: carried } }],
      ),
      'nanny-1',
    )

    expect(merged?.estimate).toEqual(estimate)
    expect(merged?.mode).toBe('break')
    expect(merged?.actual.breaks).toHaveLength(1)
  })

  it('план без факта: показатели по нулям, режима нет', () => {
    const merged = getExecution(
      orderWith({ b_execution: { schema_version: 1, estimate } }, [{ u_id: 'nanny-1' }]),
    )

    expect(merged?.estimate).toEqual(estimate)
    expect(merged?.mode).toBeNull()
    expect(merged?.actual.total_seconds).toBe(0)
    expect(merged?.actual.started).toBeNull()
  })

  it('факт без плана: заказ создан до включения функционала', () => {
    const merged = getExecution(
      orderWith(undefined, [{ u_id: 'nanny-1', c_options: { c_execution: carried } }]),
    )

    expect(merged?.estimate).toBeNull()
    expect(merged?.mode).toBe('break')
  })

  it('нет ни того ни другого — блока нет', () => {
    expect(getExecution(orderWith(undefined, [{ u_id: 'nanny-1' }]))).toBeNull()
    expect(getExecution(null)).toBeNull()
  })

  it('заказчик видит блоки всех исполнителей — берётся тот, где факт есть', () => {
    const merged = getExecution(
      orderWith(undefined, [
        { u_id: 'other', c_options: { performers_price: 100 } },
        { u_id: 'nanny-1', c_options: { c_execution: carried } },
      ]),
    )

    expect(merged?.mode).toBe('break')
  })

  it('при известном исполнителе берётся именно его блок', () => {
    const other: ICarExecution = { ...carried, mode: 'work' }
    const merged = getExecution(
      orderWith(undefined, [
        { u_id: 'other', c_options: { c_execution: other } },
        { u_id: 'nanny-1', c_options: { c_execution: carried } },
      ]),
      'nanny-1',
    )

    expect(merged?.mode).toBe('break')
  })
})
