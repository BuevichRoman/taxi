/**
 * Правила перерывов: переходы режима и расчёт показателей.
 *
 * Живут на клиенте, потому что на сервере их нет и не будет: автор кода на
 * вопрос 4 ответил, что бэкенд не дорабатывается и «все махинации на фронте».
 * Бэкенд для нас — хранилище JSON, он ничего не пересчитывает и ничего не
 * проверяет.
 *
 * Единственная реализация правил на оба клиента: няня считает и записывает
 * готовый блок, бот только читает числа. Иначе получилось бы две реализации
 * одного расчёта — ровно то, что уже случилось со стоимостью.
 *
 * Все функции чистые и принимают текущее время аргументом.
 */

import moment from 'moment'
import { dateFormat } from './dateFormats'
import {
  IActualBreak,
  ICarExecution,
  IExecutionActual,
} from '../types/types'

/**
 * Минимальная отображаемая длительность перерыва в секундах (ТЗ п. 20).
 * Более короткие завершённые перерывы не попадают в списки, но участвуют
 * в суммах и в расчёте стоимости.
 */
export const MIN_VISIBLE_BREAK_DURATION = 60

/**
 * Округление оплачиваемого времени (ТЗ п. 11.1). Правила в системе нет:
 * формула принимает длительность в минутах, перерывы идут в секундах.
 * Автор кода на вопрос 8 ответил «вверх».
 */
export const ROUNDING_UNIT_SECONDS = 60

/** Версия схемы блока. Меняется при несовместимых правках формата. */
export const SCHEMA_VERSION = 1

/**
 * Дата в формате проекта: `2026-03-18 10:03:46+03:00`, через пробел.
 * Через moment, а не Date: на строке с пробелом Date.parse ведёт себя
 * по-разному в разных браузерах, вплоть до NaN.
 */
export const apiDate = (value: Date): string =>
  moment(value).format(dateFormat)

const parse = (value: string): number => moment(value, dateFormat).valueOf()

const spanSeconds = (from: string, toMs: number): number =>
  Math.max(0, (toMs - parse(from)) / 1000)

export const roundSeconds = (seconds: number): number =>
  Math.ceil(Math.max(0, seconds) / ROUNDING_UNIT_SECONDS) * ROUNDING_UNIT_SECONDS

/**
 * Показывать ли перерыв. Активный показывается всегда — скрываются только
 * короткие завершённые интервалы.
 */
const isDisplayed = (item: { started: string, ended: string | null }): boolean =>
  item.ended === null ||
  spanSeconds(item.started, parse(item.ended)) >= MIN_VISIBLE_BREAK_DURATION

/** Суммарная длительность перерывов, включая скрытые и незавершённый */
const breakSecondsOf = (
  breaks: { started: string, ended: string | null }[],
  untilMs: number,
): number =>
  breaks.reduce(
    (sum, item) =>
      sum + spanSeconds(item.started, item.ended ? parse(item.ended) : untilMs),
    0,
  )

/**
 * Показатели за отрезок. `work` — время за вычетом перерывов, из него после
 * округления вверх получается оплачиваемое.
 */
export const totalsFrom = (
  started: string | null,
  untilMs: number,
  breaks: { started: string, ended: string | null }[],
) => {
  if (started === null) {
    return {
      total_seconds: 0,
      work_seconds: 0,
      break_seconds: 0,
      billable_work_seconds: 0,
    }
  }

  const total = spanSeconds(started, untilMs)
  const breakSeconds = Math.min(total, breakSecondsOf(breaks, untilMs))
  const work = Math.max(0, total - breakSeconds)

  return {
    total_seconds: total,
    work_seconds: work,
    break_seconds: breakSeconds,
    billable_work_seconds: roundSeconds(work),
  }
}

/** Идёт ли перерыв прямо сейчас */
export const activeBreakOf = (
  execution: ICarExecution | null | undefined,
): IActualBreak | undefined =>
  execution?.actual.breaks.find(item => item.ended === null)

/**
 * Пересчитать блок факта на текущий момент.
 *
 * @param started когда няня начала работу. Берём из `c_started` водителя:
 *   его пишет сам бэкенд действием `set_start_state`, дублировать не нужно
 * @param ended когда заказ завершён, иначе null
 */
export const buildActual = (
  started: string | null,
  ended: string | null,
  breaks: IActualBreak[],
  now: Date,
): IExecutionActual => {
  const untilMs = ended ? parse(ended) : now.getTime()

  return {
    started,
    ended,
    breaks: breaks.map(item => ({ ...item, display: isDisplayed(item) })),
    ...totalsFrom(started, untilMs, breaks),
  }
}

/** Причины отказа. Значения — ключи текстов, см. `Breaks/texts` */
export const BREAK_ERRORS = {
  orderFinished: 'ORDER_ALREADY_FINISHED',
  alreadyActive: 'BREAK_ALREADY_ACTIVE',
  notActive: 'BREAK_NOT_ACTIVE',
} as const

/**
 * Допустимо ли действие (ТЗ п. 14).
 *
 * Сервер этих проверок не делает и делать не будет, поэтому отсекаем до
 * отправки. Возвращает ключ текста отказа либо null, если можно.
 *
 * @param execution сведённые план и факт, `getExecution` из `tools/order`
 */
export const breakActionError = (
  execution: { mode: 'work' | 'break' | null, actual: IExecutionActual } | null,
  isStart: boolean,
): string | null => {
  const mode = execution?.mode ?? null

  if (execution?.actual.ended || (mode === null && execution?.actual.started)) {
    return BREAK_ERRORS.orderFinished
  }
  if (isStart && mode === 'break') return BREAK_ERRORS.alreadyActive
  if (!isStart && mode !== 'break') return BREAK_ERRORS.notActive
  return null
}

/**
 * Блок факта после начала или окончания перерыва.
 *
 * Проверки допустимости здесь нет намеренно: экран проверяет действие до
 * отправки и показывает няне понятный отказ (ТЗ п. 14). Сюда попадает уже
 * разрешённое действие.
 */
export const applyBreakAction = (
  execution: ICarExecution | null | undefined,
  isStart: boolean,
  started: string | null,
  now: Date,
): ICarExecution => {
  const stamp = apiDate(now)
  const previous = execution?.actual.breaks ?? []

  const breaks: IActualBreak[] = isStart ?
    [
      ...previous,
      {
        // Идентификатор нужен списку как ключ и боту — чтобы отличать
        // повторное сообщение об одном перерыве от нового
        id: `${previous.length + 1}-${parse(stamp)}`,
        started: stamp,
        ended: null,
        display: true,
      },
    ] :
    previous.map(item =>
      item.ended === null ? { ...item, ended: stamp } : item,
    )

  return {
    schema_version: SCHEMA_VERSION,
    mode: isStart ? 'break' : 'work',
    actual: buildActual(execution?.actual.started ?? started, null, breaks, now),
  }
}

/**
 * Блок факта на момент завершения заказа: режим снимается, незавершённый
 * перерыв закрывается тем же моментом (ТЗ п. 12 — завершение во время
 * перерыва допустимо).
 */
export const finishExecution = (
  execution: ICarExecution | null | undefined,
  started: string | null,
  now: Date,
): ICarExecution => {
  const stamp = apiDate(now)
  const breaks = (execution?.actual.breaks ?? []).map(item =>
    item.ended === null ? { ...item, ended: stamp } : item,
  )

  return {
    schema_version: SCHEMA_VERSION,
    mode: null,
    actual: buildActual(
      execution?.actual.started ?? started,
      stamp,
      breaks,
      now,
    ),
  }
}
