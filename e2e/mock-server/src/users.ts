/**
 * Пользователи мока: регистрация, чтение и правка профиля.
 *
 * Нужны для прогона бота целиком (`tests/test_adapter_neworch.ts`): до экрана
 * заказа он проходит выбор языка, согласие с документами и регистрацию, и на
 * каждом шаге ходит в `/user` и `/register`.
 *
 * Проверок доступа нет — это мок: любой запрос считается авторизованным.
 */

export interface MockUser {
    u_id: string
    u_name: string
    u_family: string
    u_role: string
    u_lang: string
    u_city: string
    u_phone: string
    /** 1 требуется верификация, 2 активный, 3 отклонена, 4 заблокирован */
    u_check_state: string
    referrer_u_id: string
    u_details: Record<string, unknown>
    /** Привязки к каналам: Telegram, WhatsApp, телефон */
    u_a_tg?: string
    u_a_wa?: string
    u_a_phone?: string
}

/** Поля, по которым бот находит пользователя */
const ID_FIELDS = ['u_a_tg', 'u_a_wa', 'u_a_phone'] as const

const users = new Map<string, MockUser>()
let nextUserId = 1

export function resetUsers(): void {
    users.clear()
    nextUserId = 1
}

export function allUsers(): MockUser[] {
    return [...users.values()]
}

export function findUserById(uId: string): MockUser | undefined {
    return users.get(uId)
}

/**
 * Поиск по идентификатору канала. `chatId` бот присылает, когда транспорт не
 * Telegram и не WhatsApp — считаем его тем же telegram-идентификатором,
 * иначе пользователь, зарегистрированный через TestAdapter, не находился бы.
 */
export function findUserByIdField(field: Record<string, unknown>): MockUser | undefined {
    const chatId = field['chatId']
    const lookup: Record<string, unknown> = { ...field }
    if (typeof chatId === 'string' && lookup['u_a_tg'] === undefined) lookup['u_a_tg'] = chatId

    for (const key of ID_FIELDS) {
        const value = lookup[key]
        if (typeof value !== 'string' || value === '') continue
        const found = [...users.values()].find(user => user[key] === value)
        if (found) return found
    }
    return undefined
}

/**
 * Операции над `u_details` приходят списком вида
 * `[['=', ['docs','public_offer','version'], '1']]` — путь и значение.
 * Поддерживаем только присваивание: других бот не шлёт.
 */
function applyDetailOps(target: Record<string, unknown>, ops: unknown[]): void {
    for (const op of ops) {
        if (!Array.isArray(op) || op.length < 3) continue
        const [action, rawPath, value] = op as [unknown, unknown, unknown]
        if (action !== '=' || !Array.isArray(rawPath) || rawPath.length === 0) continue

        let node = target
        for (const segment of rawPath.slice(0, -1) as string[]) {
            const next = node[segment]
            if (!next || typeof next !== 'object') node[segment] = {}
            node = node[segment] as Record<string, unknown>
        }
        node[String(rawPath[rawPath.length - 1])] = value
    }
}

/** Применяет к пользователю поля из JSON-строки `data` запроса */
export function applyUserData(user: MockUser, payload: Record<string, unknown>): void {
    for (const key of ['u_name', 'u_family', 'u_lang', 'u_city', 'u_phone', 'referrer_u_id'] as const) {
        const value = payload[key]
        if (typeof value === 'string') user[key] = value
    }

    const details = payload['u_details']
    if (Array.isArray(details)) {
        applyDetailOps(user.u_details, details)
    } else if (details && typeof details === 'object') {
        Object.assign(user.u_details, details)
    }
}

/**
 * Отмечает документы принятыми. Бот сравнивает версии в `u_details.docs`
 * с максимальными версиями из `site_constants.bot_legal_docs` и при
 * расхождении снова просит согласие.
 */
export function acceptDocs(user: MockUser, versions: Record<string, string>): void {
    const accepted = new Date().toISOString()
    const docs: Record<string, { version: string; accepted: string }> = {}
    for (const [name, version] of Object.entries(versions)) {
        docs[name] = { version, accepted }
    }
    user.u_details['docs'] = docs
}

/**
 * Регистрация. Роль 1 — заказчик, 2 — исполнитель. Няня заводится в состоянии
 * «требуется верификация», как на боевом стенде: активировать её может только
 * администратор.
 */
export function createUser(input: {
    u_role?: string
    u_name?: string
    ref_code?: string
    u_tg?: string
    u_wa?: string
    chatId?: string
    data?: Record<string, unknown>
    /** Проставить согласие с документами этих версий: `{ public_offer: '0', ... }` */
    docsVersions?: Record<string, string>
}): MockUser {
    const uId = String(nextUserId++)
    const role = String(input.u_role ?? '1')
    const telegramId = input.u_tg ?? input.chatId

    const user: MockUser = {
        u_id: uId,
        u_name: input.u_name ?? '',
        u_family: '',
        u_role: role,
        u_lang: '1',
        u_city: '',
        u_phone: '',
        u_check_state: role === '2' ? '1' : '2',
        referrer_u_id: input.ref_code ?? '',
        u_details: {},
        ...(telegramId ? { u_a_tg: telegramId } : {}),
        ...(input.u_wa ? { u_a_wa: input.u_wa } : {}),
    }

    if (input.data) applyUserData(user, input.data)
    if (input.docsVersions) acceptDocs(user, input.docsVersions)
    const phone = (user.u_details as { phone?: unknown }).phone
    if (typeof phone === 'string' && phone !== '') {
        user.u_phone = phone
        user.u_a_phone = phone
    }

    users.set(uId, user)
    return user
}
