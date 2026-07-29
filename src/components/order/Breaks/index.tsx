import React, { useEffect, useRef, useState } from 'react'
import moment from 'moment'
import { IActualBreak, IOrder } from '../../../types/types'
import { tBreak } from './texts'
import { TRANSLATION } from '../../../localization'
import './styles.scss'

/**
 * Текущее время сервера.
 *
 * Часы устройства использовать нельзя (ТЗ п. 4), поэтому смещение считается
 * один раз по метке server_time из ответа, а дальше время идёт от него.
 * Пересчитывается при каждом новом ответе сервера.
 */
const useServerNow = (serverTime?: string): (() => number) => {
  const offset = useRef(0)
  const [, tick] = useState(0)

  useEffect(() => {
    if (serverTime) offset.current = Date.parse(serverTime) - Date.now()
  }, [serverTime])

  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return () => Date.now() + offset.current
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours > 0) return `${hours} ч ${minutes} мин`
  if (minutes > 0) return `${minutes} мин`
  return `${total} с`
}

const formatTime = (iso: string): string => moment(iso).format('HH:mm')

interface IProps {
  order: IOrder
}

const Breaks: React.FC<IProps> = ({ order }) => {
  const execution = order.b_execution
  const serverNow = useServerNow(order.server_time)

  if (!execution || !execution.actual.started) return null

  const { actual, estimate, mode } = execution
  const onBreak = mode === 'break'

  // Показатели с сервера актуальны на момент server_time. Между опросами
  // растёт только один из счётчиков — в зависимости от текущего режима
  const elapsed = order.server_time && mode !== null ?
    Math.max(0, (serverNow() - Date.parse(order.server_time)) / 1000) :
    0

  const totalSeconds = actual.total_seconds + elapsed
  const breakSeconds = actual.break_seconds + (onBreak ? elapsed : 0)
  const workSeconds = actual.work_seconds + (onBreak ? 0 : elapsed)

  const activeBreak = actual.breaks.find(item => item.ended === null)
  const visibleBreaks = actual.breaks.filter(item => item.display && item.ended !== null)

  const renderBreak = (item: IActualBreak) => (
    <li key={item.id} className="breaks_item">
      <span>{formatTime(item.started)} — {formatTime(item.ended as string)}</span>
      <span className="breaks_item-duration">
        {formatDuration((Date.parse(item.ended as string) - Date.parse(item.started)) / 1000)}
      </span>
    </li>
  )

  return (
    <div className={`breaks ${onBreak ? 'breaks--on-break' : ''}`}>
      <div className="breaks_state">
        <span className="breaks_state-label">
          {onBreak ? tBreak(TRANSLATION.STATE_ON_BREAK) : tBreak(TRANSLATION.STATE_WORKING)}
        </span>
        {activeBreak && (
          <span className="breaks_state-since">
            {tBreak(TRANSLATION.BREAK_ON_SINCE)} {formatTime(activeBreak.started)}
            {' · '}
            {formatDuration((serverNow() - Date.parse(activeBreak.started)) / 1000)}
          </span>
        )}
      </div>

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
