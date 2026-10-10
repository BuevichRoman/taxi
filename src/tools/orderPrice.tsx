import React, { useEffect, useState } from 'react'
import * as API from '../API'
import { EBookingStates, IOrder } from '../types/types'
import { calculateFinalPrice } from './order'

/** Ответы сервера по ключу «заказ:минуты» — общие для всех экранов */
const cache = new Map<string, Promise<string>>()

export function fetchOrderPrice(id: IOrder['b_id'], durationMin?: number): Promise<string> {
  const key = `${id}:${durationMin ?? 'final'}`
  let price = cache.get(key)
  if (!price) {
    price = API.getOrderPrice(id, durationMin).then(r => r.price)
    // Ошибку не кешируем: следующий показ спросит снова
    price.catch(() => cache.delete(key))
    cache.set(key, price)
  }
  return price
}

/**
 * Цена заказа для показа. Считает сервер (шаблон nanny_pricing):
 * - с durationMin — по снимку заказа за заданные минуты;
 * - без него у завершённого заказа — итог по факту;
 * - иначе — цена, которую сервер записал в заказ при создании.
 * Пока ответа нет — «…», при ошибке — цена из заказа.
 */
export function useOrderPrice(order: IOrder | null | undefined, durationMin?: number): string {
  const stored = calculateFinalPrice(order ?? null)
  const id = order?.b_id
  const ask = !!id && (durationMin !== undefined || order?.b_state === EBookingStates.Completed)
  const [price, setPrice] = useState<string | null>(null)

  useEffect(() => {
    if (!ask || !id) return
    let alive = true
    setPrice(null)
    fetchOrderPrice(id, durationMin)
      .then(p => { if (alive) setPrice(p) })
      .catch(() => { if (alive) setPrice(stored) })
    return () => { alive = false }
  }, [ask, id, durationMin, stored])

  if (!ask) return stored
  return price ?? '…'
}

/** Цена за заданные минуты — для таблиц, где цен несколько */
export function OrderPrice({ order, durationMin }: { order: IOrder, durationMin: number }) {
  return <>{useOrderPrice(order, durationMin)}</>
}
