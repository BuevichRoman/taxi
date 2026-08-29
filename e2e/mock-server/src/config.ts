/**
 * Конфигурация мока.
 *
 * Значения расчёта взяты из боевой константы `site_constants.pricingModels`
 * тенанта `children` (https://ibronevik.ru/taxi/cache/data_children.js),
 * модель `basic`. Менять их здесь имеет смысл только для проверки сценариев.
 */

export const PRICING = {
    base_price: 200,
    price_per_km: 10,
    price_per_minute: 5,
    time_ratio: { day: 1, night: 0.5 },
    car_class_ratio: { 1: 1, 2: 1.5, 3: 2 } as Record<number, number>,
}

/**
 * Округление оплачиваемого времени (ТЗ п. 11.1).
 *
 * В боевой системе правила нет: формула принимает `duration` в минутах, а
 * перерывы регистрируются в секундах. Автор кода на вопрос 8 ответил
 * «вверх» — округляем вверх до целой минуты.
 */
export const ROUNDING = {
    unitSeconds: 60,
    mode: 'up' as 'up' | 'down' | 'nearest',
}

/**
 * Минимальная отображаемая длительность перерыва в секундах (ТЗ п. 20).
 * Перерывы короче не попадают в списки, но участвуют в агрегатах и расчёте.
 */
export const MIN_VISIBLE_BREAK_DURATION = 60

/** Версия схемы `b_execution`, отдаваемая клиентам. */
export const SCHEMA_VERSION = 1

export const PORT = Number(process.env.PORT ?? 4010)
