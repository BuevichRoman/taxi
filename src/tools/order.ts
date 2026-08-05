import moment from 'moment'
import SITE_CONSTANTS from '../siteConstants'
import { DEFAULT_CITY_ID, PROFIT_RANKS } from '../constants/orders'
import {
  EBookingStates,
  EDriverResponseModes,
  EOrderProfitRank,
  IOrder,
  ICar,
  ICarExecution,
  IOrderEstimation,
  IOrderExecution,
} from '../types/types'
import { IWayGraph, IWayGraphNode } from './maps'

/**
 * План и факт перерывов, сведённые вместе.
 *
 * Хранятся раздельно и пишутся разными людьми: план — заказчиком в
 * `b_options.b_execution` при создании заказа, факт — няней в своём
 * `c_options.c_execution`. В `b_options` няне писать нельзя: метод `edit`
 * разрешает исполнителю только `c_options`.
 *
 * @param uId идентификатор няни. Заказчик видит блоки всех исполнителей,
 *   няня — только свой, поэтому без подсказки берём первый попавшийся
 */
export const getExecution = (
  order: IOrder | null,
  uId?: string,
): IOrderExecution | null => {
  if (!order) return null

  const drivers = order.drivers ?? []
  const mine = uId ? drivers.find(item => item.u_id === uId) : undefined
  const carried: ICarExecution | undefined =
    (mine ?? drivers.find(item => item.c_options?.c_execution))
      ?.c_options?.c_execution

  const estimate = order.b_options?.b_execution?.estimate ?? null
  if (!carried && !estimate) return null

  return {
    schema_version:
      carried?.schema_version ??
      order.b_options?.b_execution?.schema_version ??
      0,
    mode: carried?.mode ?? null,
    estimate,
    actual: carried?.actual ?? {
      started: null,
      ended: null,
      breaks: [],
      total_seconds: 0,
      work_seconds: 0,
      break_seconds: 0,
      billable_work_seconds: 0,
    },
  }
}

export function updateCompletedOrderDuration(order: IOrder): IOrder {
  if (
    order.b_state === EBookingStates.Completed &&
    order.b_options?.pricingModel
  ) {
    order = {
      ...order,
      b_options: {
        ...order.b_options,
        pricingModel: {
          ...order.b_options.pricingModel,
          options: {
            ...(order.b_options.pricingModel.options || {}),
            duration: moment(order.b_completed)
              .diff(order.b_start_datetime, 'minutes'),
          },
        },
      },
    }
    const newPrice = calculateFinalPrice(order)
    if (typeof newPrice === 'number')
      order.b_options!.pricingModel!.price = newPrice
  }
  return order
}

export const calculateFinalPriceFormula = (order: IOrder | null) => {
  if (!order) {
    return 'err'
  }
  if (!order?.b_options?.pricingModel?.formula) {
    return 'err'
  }
  let formula = order.b_options?.pricingModel?.formula
  let options = order.b_options?.pricingModel?.options || {}

  // pick up submitPrice from b_options
  options = {
    ...options,
    ...{
      submit_price: order.b_options?.submitPrice,
      distance: order.b_options?.pricingModel?.calculationType === 'incomplete'? '?' : order.b_options?.pricingModel?.options?.distance,
      duration:  order.b_options?.pricingModel?.calculationType === 'incomplete' && order.b_options?.pricingModel?.options?.duration === 0? '?' : order.b_options?.pricingModel?.options?.duration,
    },
  }
  // Replace all placeholders in the formula with their values
  Object.entries(options).forEach(([key, value]) => {
    const placeholder = `${key}`
    formula = (formula || 'error_0x01').replace(new RegExp(placeholder, 'g'), value === '?' ? '?' :Math.trunc(value)?.toString() || '0')
  })

  const timeRatioMatch = (formula || 'error_0x02').match(/\(([^)]+)\)\*(\d+(?:\.\d+)?)/)
  if (timeRatioMatch) {
    const coefficient = parseFloat(timeRatioMatch[2])
    if (coefficient === 1) {
      // If coefficient is 1, remove parentheses and multiplication
      formula = (formula || 'error_0x03').replace(/\(([^)]+)\)\*\d+(?:\.\d+)?/, '$1')
    }
  }

  return formula
}

export const calculateFinalPrice = (order: IOrder | null) => {
  if (!order) {
    return 'err'
  }
  if(!order.b_options?.pricingModel?.formula) {
    return 'err'
  }
  if(order.b_options?.pricingModel?.formula === '-') {
    return '-'
  }
  let formula  = order.b_options?.pricingModel?.formula
  let options = order.b_options?.pricingModel?.options || {}

  // pick up submitPrice from b_options
  options = {
    ...options,
    ...{
      submit_rice: order.b_options?.submitPrice,
    },
  }
  if (!formula || formula === 'err') {
    return 'err'
  }
  Object.entries(options).forEach(([key, value]) => {
    const placeholder = `${key}`
    formula = formula.replace(new RegExp(placeholder, 'g'), value?.toString() || '0')
  })
  console.log('FINAL FORMULA', formula, '=', eval(formula), ' ~ ', Math.trunc(eval(formula)))
  try {
    return Math.trunc(eval(formula)).toString()
  } catch (e) {
    return 'err, status: ' + e
  }
}

export function candidateMode(order?: IOrder): boolean {
  switch (SITE_CONSTANTS.DRIVER_RESPONSE_MODE) {
    case EDriverResponseModes.Performer:
      return false
    case EDriverResponseModes.Candidate:
      return true
    case EDriverResponseModes.ByOrder:
      for (const id of order?.b_comments ?? [])
        switch (SITE_CONSTANTS.BOOKING_COMMENTS[id].responseMode) {
          case EDriverResponseModes.Performer:
            return false
          case EDriverResponseModes.Candidate:
            return true
        }
      return false
    default:
      throw new Error('Not implemented')
  }
}

export function estimateOrder(
  order: IOrder,
  car: ICar,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): IOrderEstimation {
  const profit = estimateProfit(order, car, startingPoint, graph)
  const profitRank = profit && rankProfit(profit)
  return { profit, profitRank }
}

export function estimateProfit(
  order: IOrder,
  car: ICar,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): number | undefined {
  let factors = SITE_CONSTANTS.CALCULATION_BENEFITS
    [DEFAULT_CITY_ID]?.[car.cc_id]
  if (!factors)
    return
  const distance = calculateDistance(order, startingPoint, graph)
  if (!distance)
    return

  const orderTime = moment(0)
  for (const part of ['hours', 'minutes', 'seconds'] as const)
    orderTime.set(part, order.b_start_datetime.get(part))
  const factorsModification = factors.time_modifications.find(({
    start, end,
  }) =>
    start < end ?
      start < orderTime && orderTime < end :
      end < orderTime && orderTime < start,
  )
  if (factorsModification)
    factors = { ...factors, ...factorsModification }

  const [startingPointToOrder, startToDestination] = distance
    .map(distance => distance / 1000)
  const { fuel_cost, rate, base_fare, min_fare } = factors
  const income = Math.max(base_fare + rate * startToDestination, min_fare)
  const cost = fuel_cost * (startingPointToOrder + startToDestination)
  return income - cost
}

export function rankProfit(profit: number): EOrderProfitRank {
  const ranks = [...PROFIT_RANKS].sort(([, a], [, b]) => a - b)
  let rank = EOrderProfitRank.Low
  for (const [minProfitRank, minProfit] of ranks)
    if (profit >= minProfit)
      rank = minProfitRank
  return rank
}

export function calculateDistance(
  order: IOrder,
  startingPoint: [lat: number, lng: number],
  graph: IWayGraph,
): [startingPointToOrder: number, startToDestination: number] | undefined {
  if (!(
    order.b_start_latitude && order.b_start_longitude &&
    order.b_destination_latitude && order.b_destination_longitude
  ))
    return

  const nodes: IWayGraphNode[] = []
  for (const [lat, lng] of [
    startingPoint,
    [order.b_start_latitude, order.b_start_longitude],
    [order.b_destination_latitude, order.b_destination_longitude],
  ]) {
    const [node] = graph.findClosestNode(lat, lng)
    if (!node)
      return
    nodes.push(node)
  }
  const [startNode, orderStartNode, destinationNode] = nodes

  const distances: number[] = []
  for (const [start, destination] of [
    [startNode, orderStartNode],
    [orderStartNode, destinationNode],
  ]) {
    const [, distance] = graph.findShortestPath(start.id, destination.id)
    if (distance === Infinity)
      return
    distances.push(distance)
  }
  const [startingPointToOrder, startToDestination] = distances

  return [startingPointToOrder, startToDestination]
}