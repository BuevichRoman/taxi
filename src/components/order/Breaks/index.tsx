import React, { useEffect, useRef, useState } from 'react'
import moment from 'moment'
import { IActualBreak, IOrder } from '../../../types/types'
import { tBreak } from './texts'
import { TRANSLATION } from '../../../localization'
import { dateFormat } from '../../../tools/utils'
import { calculateFinalPrice, getExecution } from '../../../tools/order'
import { serverNow } from '../../../tools/serverClock'
import './styles.scss'

/**
 * Метка времени сервера в миллисекунды.
 *
 * Формат разбираем явно: сервер отдаёт `2026-03-18 10:03:46+00:00` — через
 * пробел, как принято в проекте (dateFormat). Date.parse на такой строке
 * ведёт себя по-разному в разных браузерах, вплоть до NaN.
 */
const parseServer = (value: string): number => moment(value, dateFormat).valueOf()

/**
 * Текущее время для таймеров.
 *
 * По ТЗ (п. 4) отсчёт ведётся от серверного времени. Источников два: метка
 * прямо в ответе, если она есть, — она точнее, потому что относится к самим
 * данным; иначе общие часы приложения, выправленные по заголовку `Date`
 * ответов API (tools/serverClock). Часы устройства не используются.
 */
const useServerNow = (serverTime?: string): (() => number) => {
  const offset = useRef(0)
  const [, tick] = useState(0)

  useEffect(() => {
    if (serverTime) offset.current = parseServer(serverTime) - Date.now()
  }, [serverTime])

  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return () => serverTime ? Date.now() + offset.current : serverNow().getTime()
}

/**
 * Момент, к которому относятся показатели ответа: метка сервера, если она
 * пришла, иначе время получения ответа. Пересчитывается на каждом новом
 * ответе — от этой точки растут счётчики между опросами.
 */
const useMeasuredAt = (execution: unknown, serverTime?: string): number => {
  const at = useRef(Date.now())

  useEffect(() => {
    at.current = serverTime ? parseServer(serverTime) : serverNow().getTime()
  }, [execution, serverTime])

  return at.current
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours > 0) return `${hours} ч ${minutes} мин`
  if (minutes > 0) return `${minutes} мин`
  return `${total} с`
}

const formatTime = (value: string): string => moment(value, dateFormat).format('HH:mm')

interface IProps {
  order: IOrder
}

const Breaks: React.FC<IProps> = ({ order }) => {
  // План и факт хранятся раздельно: план — в b_options заказа, факт — в
  // c_options няни. Писать в b_options исполнителю нельзя
  const execution = getExecution(order)
  const serverNow = useServerNow(order.server_time)
  const measuredAt = useMeasuredAt(execution, order.server_time)

  if (!execution || !execution.actual.started) return null

  const { actual, estimate, mode } = execution
  const onBreak = mode === 'break'

  // Показатели из ответа актуальны на момент measuredAt. Между опросами
  // растёт только один из счётчиков — в зависимости от текущего режима
  const elapsed = mode !== null ?
    Math.max(0, (serverNow() - measuredAt) / 1000) :
    0

  const totalSeconds = actual.total_seconds + elapsed
  const breakSeconds = actual.break_seconds + (onBreak ? elapsed : 0)
  const workSeconds = actual.work_seconds + (onBreak ? 0 : elapsed)

  const activeBreak = actual.breaks.find(item => item.ended === null)
  const visibleBreaks = actual.breaks.filter(item => item.display && item.ended !== null)

  /**
   * Стоимость по оплачиваемому времени. Считается тем же механизмом, что и
   * везде в приложении (ТЗ п. 11: единый алгоритм расчёта), — подставляем в
   * модель длительность в минутах и отдаём в существующую формулу
   */
  const priceFor = (billableSeconds: number): string => {
    const model = order.b_options?.pricingModel
    if (!model) return '—'

    return calculateFinalPrice({
      ...order,
      b_options: {
        ...order.b_options,
        pricingModel: {
          ...model,
          options: { ...model.options, duration: Math.ceil(billableSeconds / 60) },
        },
      },
    }).toString()
  }

  /** Отклонение факта от плана со знаком */
  const deviation = (fact: number, plan: number): string => {
    const diff = Math.round(fact - plan)
    if (diff === 0) return '—'
    return `${diff > 0 ? '+' : '−'}${formatDuration(Math.abs(diff))}`
  }

  const renderBreak = (item: IActualBreak) => (
    <li key={item.id} className="breaks_item">
      <span>{formatTime(item.started)} — {formatTime(item.ended as string)}</span>
      <span className="breaks_item-duration">
        {formatDuration((parseServer(item.ended as string) - parseServer(item.started)) / 1000)}
      </span>
    </li>
  )

  return (
    <div className={`breaks ${onBreak ? 'breaks--on-break' : ''}`}>
      <div className="breaks_state">
        <span className="breaks_state-label">
          {actual.ended ?
            tBreak(TRANSLATION.STATE_FINISHED) :
            tBreak(onBreak ? TRANSLATION.STATE_ON_BREAK : TRANSLATION.STATE_WORKING)}
        </span>
        {activeBreak && (
          <span className="breaks_state-since">
            {tBreak(TRANSLATION.BREAK_ON_SINCE)} {formatTime(activeBreak.started)}
            {' · '}
            {formatDuration((serverNow() - parseServer(activeBreak.started)) / 1000)}
          </span>
        )}
      </div>

      {/* У завершённого заказа те же цифры показывает сводка ниже */}
      {!actual.ended && <>
      <dl className="breaks_totals">
        <div>
          <dt>{tBreak(TRANSLATION.TIME_TOTAL)}</dt>
          <dd>{formatDuration(totalSeconds)}</dd>
        </div>
        <div>
          <dt>{tBreak(TRANSLATION.TIME_WORK)}</dt>
          <dd>{formatDuration(workSeconds)}</dd>
        </div>
        <div>
          <dt>{tBreak(TRANSLATION.TIME_BREAKS)}</dt>
          <dd>{formatDuration(breakSeconds)}</dd>
        </div>
      </dl>

      {estimate && (
        <div className="breaks_plan">
          {tBreak(TRANSLATION.PLAN_SHORT)}: {tBreak(TRANSLATION.TIME_WORK).toLowerCase()}
          {' '}{formatDuration(estimate.work_seconds)},
          {' '}{tBreak(TRANSLATION.TIME_BREAKS).toLowerCase()}
          {' '}{formatDuration(estimate.break_seconds)}
        </div>
      )}
      </>}

      {actual.ended && (
        <table className="breaks_summary">
          <thead>
            <tr>
              <th />
              <th>{tBreak(TRANSLATION.PLAN_SHORT)}</th>
              <th>{tBreak(TRANSLATION.FACT_SHORT)}</th>
              <th>{tBreak(TRANSLATION.DEVIATION)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{tBreak(TRANSLATION.TIME_TOTAL)}</td>
              <td>{estimate ? formatDuration(estimate.total_seconds) : '—'}</td>
              <td>{formatDuration(actual.total_seconds)}</td>
              <td>{estimate ? deviation(actual.total_seconds, estimate.total_seconds) : '—'}</td>
            </tr>
            <tr>
              <td>{tBreak(TRANSLATION.TIME_WORK)}</td>
              <td>{estimate ? formatDuration(estimate.work_seconds) : '—'}</td>
              <td>{formatDuration(actual.work_seconds)}</td>
              <td>{estimate ? deviation(actual.work_seconds, estimate.work_seconds) : '—'}</td>
            </tr>
            <tr>
              <td>{tBreak(TRANSLATION.TIME_BREAKS)}</td>
              <td>{estimate ? formatDuration(estimate.break_seconds) : '—'}</td>
              <td>{formatDuration(actual.break_seconds)}</td>
              <td>{estimate ? deviation(actual.break_seconds, estimate.break_seconds) : '—'}</td>
            </tr>
            <tr>
              <td>{tBreak(TRANSLATION.PRICE_FINAL)}</td>
              <td>{estimate ? priceFor(estimate.billable_work_seconds) : '—'}</td>
              <td>{priceFor(actual.billable_work_seconds)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      <div className="breaks_list">
        <div className="breaks_list-header">
          <span>{tBreak(TRANSLATION.BREAKS_LIST)}</span>
          <span>{visibleBreaks.length}</span>
        </div>
        {visibleBreaks.length > 0 ?
          <ul>{visibleBreaks.map(renderBreak)}</ul> :
          <div className="breaks_list-empty">{tBreak(TRANSLATION.BREAKS_NONE)}</div>
        }
      </div>
    </div>
  )
}

export default Breaks
