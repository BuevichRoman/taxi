/**
 * Состояние заказа в моке.
 *
 * Мок намеренно глупый: он хранит JSON и переключает состояние заказа, но
 * ничего не считает и перерывы не проверяет. Так устроен и боевой бэкенд —
 * автор кода на вопрос 4 ответил, что доработок не будет и «все махинации
 * на фронте». Пока мок считал сам, зелёные тесты означали лишь то, что мок
 * согласен с моком.
 *
 * Правила перерывов живут в приложении няни: `src/tools/execution.ts`.
 */

export interface Order {
    b_id: string
    /** Кто исполнитель. Его же `c_options` правятся действием `edit` */
    performer_u_id: string
    /** Поля заказа: план перерывов, модель расчёта, время окончания */
    b_options: Record<string, unknown>
    /**
     * Своё поле исполнителя по заказу: там лежит факт.
     *
     * null — поле не заполнено. Правку edit в него не положить: бэкенд
     * проверяет is_array до первого ключа, а json_decode('') даёт null.
     * Заполняет его set_performer при взятии заказа
     */
    c_options: Record<string, unknown> | null
    /** `c_started` исполнителя, ставится действием `set_start_state` */
    started_at: string | null
    /** `c_completed` исполнителя, ставится действием `set_complete_state` */
    ended_at: string | null
    finished: boolean
}

/** Дата в формате проекта: через пробел, со смещением */
export const apiDate = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const offsetMinutes = -d.getTimezoneOffset()
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMinutes)

    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    )
}

/**
 * `set_start_state` — няня начала выполнение.
 * Бэкенд отмечает только момент, блок перерывов заводит клиент.
 */
export function startWork(order: Order, now: Date): void {
    order.started_at = apiDate(now)
}

/**
 * `set_complete_state` — заказ завершён.
 *
 * Открытый перерыв здесь не закрывается: это делает приложение няни
 * отдельной правкой до завершения. Боевой бэкенд про перерывы не знает.
 */
export function completeOrder(order: Order, now: Date): void {
    order.ended_at = apiDate(now)
    order.finished = true
}
