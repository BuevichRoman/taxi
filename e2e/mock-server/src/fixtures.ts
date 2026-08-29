/**
 * Демонстрационные данные для прогона сценариев в интерфейсе.
 *
 * Значения отдаются строками там, где боевой API отдаёт строки: клиент
 * приводит типы сам (`convertTypes` в `src/tools/convert.ts`), и на числах
 * вместо строк часть полей молча потерялась бы.
 */

/** Няня — исполнитель заказа */
export const NANNY = {
    u_id: 'nanny-1',
    u_name: 'Мария',
    u_family: 'Петрова',
    u_middle: 'Ивановна',
    u_role: '2',
    u_email: 'nanny@example.com',
    u_phone: '79990000001',
    u_active: '1',
    u_phone_checked: '1',
    u_tips: '0',
}

/** Заказчик */
export const CLIENT = {
    u_id: 'client-1',
    u_name: 'Ирина',
    u_family: 'Смирнова',
    u_middle: 'Сергеевна',
    u_role: '1',
    u_email: 'client@example.com',
    u_phone: '79990000002',
    u_active: '1',
    u_phone_checked: '1',
    u_tips: '0',
}

export const USERS: Record<string, Record<string, string>> = {
    [NANNY.u_id]: NANNY,
    [CLIENT.u_id]: CLIENT,
}

export const TOKENS = {
    token: 'mock-token',
    u_hash: 'mock-u-hash',
}

/**
 * Поля заказа, не относящиеся к перерывам. Нужны, чтобы экран заказа
 * отрисовался: адреса, заказчик, состояние, назначенный исполнитель.
 */
export const bookingBase = (id: string, startIso: string) => ({
    b_id: id,
    b_state: '2', // Approved
    b_start_address: 'ул. Тверская, 12',
    b_destination_address: 'Школа №1234, ул. Садовая, 5',
    b_start_latitude: '55.7615',
    b_start_longitude: '37.6094',
    b_destination_latitude: '55.7712',
    b_destination_longitude: '37.6320',
    b_start_datetime: startIso,
    b_created: startIso,
    b_passengers_count: '1',
    b_car_class: '1',
    b_payment_way: '1',
    b_estimate_waiting: '0',
    b_comments: '',
    u_id: CLIENT.u_id,
    b_contact: `${CLIENT.u_name} ${CLIENT.u_family}`,
    // Поверх этих ключей ложится всё наше: b_execution и b_end_datetime
    // приходят внутри b_options, отдельных полей заказа под них нет
    b_options: {
        childrenProfiles: '1',
        pricingModel: {
            formula:
                '(base_price+distance*price_per_km+duration*price_per_minute)' +
                '*time_ratio*car_class_ratio+options_sum+submit_price',
            options: {
                base_price: 200,
                distance: 0,
                price_per_km: 10,
                duration: 0,
                price_per_minute: 5,
                time_ratio: 1,
                options_sum: 0,
                submit_price: 0,
                car_class_ratio: 1,
            },
            calculationType: 'incomplete',
        },
    } as Record<string, unknown>,
})

/**
 * Исполнитель в том виде, в каком его ждёт экран заказа:
 * `drivers` с состоянием `c_state` (5 — начал выполнение).
 */
export const driverEntry = (startedAt: string | null) => ({
    u_id: NANNY.u_id,
    c_state: startedAt ? '5' : '3',
    c_started: startedAt,
    u_name: NANNY.u_name,
    u_family: NANNY.u_family,
    u_middle: NANNY.u_middle,
    u_phone: NANNY.u_phone,
})
