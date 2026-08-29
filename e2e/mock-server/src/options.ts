/**
 * Правки `b_options` и `c_options` действием `edit`.
 *
 * Это перенос поведения боевого бэкенда, а не наша выдумка: разбор списка
 * правок лежит в `models/api.php:9466-9745`, проверка белых списков — там же.
 * Сообщения об ошибках повторяются дословно, иначе мок не поймает то, на чём
 * споткнётся боевой API.
 *
 * Ключевое, что мок обязан воспроизводить:
 *   - значение поля — не объект, а список правок `[оператор, путь, значение]`;
 *   - создавать можно только ключи из белого списка, вложенные — свободно,
 *     если в списке у ключа стоит `true`;
 *   - исполнителю доступен только `c_options`, `b_options` ему недоступен.
 *
 * Логики перерывов здесь нет и быть не должно: бэкенд их не считает и не
 * проверяет, для него это просто сохранённый JSON. Считает приложение няни.
 */

export type ApiErrorCode = 'error'

export class ApiError extends Error {
    readonly code: ApiErrorCode = 'error'

    constructor(message: string) {
        super(message)
    }
}

/** Белый список: `true` — ниже можно всё, объект — только перечисленные ключи */
export type ValidKeys = Record<string, unknown>

/**
 * Белые списки тенанта `children`, как они лежат в его константах.
 *
 * `b_options_valid_keys` приведён не полностью: только те ключи, что
 * встречаются в наших сценариях. `b_execution` и `b_end_datetime` добавлены
 * запросом sql/001, `c_execution` — запросом sql/003.
 */
export const B_OPTIONS_VALID_KEYS: ValidKeys = {
    childrenProfiles: true,
    pricingModel: true,
    fromShortAddress: true,
    toShortAddress: true,
    b_execution: true,
    b_end_datetime: true,
}

export const C_OPTIONS_VALID_KEYS: ValidKeys = {
    performers_price: true,
    c_execution: true,
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** Всё, во что можно спуститься. В PHP это `is_array` — и словарь, и список */
const isContainer = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null

/**
 * Применить одну правку.
 *
 * @param field `b_options` или `c_options` — только для текста ошибки,
 *   боевой бэкенд подставляет туда имя поля
 */
function applyOne(
    target: Record<string, unknown>,
    element: unknown,
    validKeys: ValidKeys,
    field: string,
): void {
    if (!Array.isArray(element)) throw new ApiError(`${field} element not array`)

    const operator = typeof element[0] === 'string' ? element[0].trim() : ''
    if (!operator) throw new ApiError(`${field} element without operator`)

    if (operator !== '=' && operator !== '+' && operator !== '-') {
        throw new ApiError(`wrong ${field} element operator`)
    }

    const path = element[1]
    const verb = operator === '=' ? 'assignment' : operator === '+' ? 'addition' : 'removal'

    if (path === undefined) throw new ApiError(`empty ${field} element keys for ${verb}`)
    if (!Array.isArray(path)) throw new ApiError(`${field} element keys for ${verb} not array`)

    // Значение проверяется через isset(), а isset(null) — это false, поэтому
    // присвоить null нельзя: отличить его от отсутствующего значения бэкенд
    // не умеет. Проверено на боевом 05.08.2026
    if (operator !== '-' && (element[2] === undefined || element[2] === null)) {
        throw new ApiError(`empty ${field} element value for ${verb}`)
    }

    // Удаление белым списком не проверяется: убрать можно то, что уже лежит
    if (operator === '-') {
        let cursor: unknown = target
        for (let i = 0; i < path.length - 1; i++) {
            if (!isPlainObject(cursor)) return
            cursor = cursor[String(path[i])]
        }
        if (isPlainObject(cursor) && path.length > 0) delete cursor[String(path[path.length - 1])]
        return
    }

    // Проверка is_array стоит в начале каждого шага спуска, то есть и до
    // первого ключа тоже. У исполнителя с незаполненным полем json_decode('')
    // даёт null, и первая же правка отбивается. Значит edit не умеет
    // создавать поле с нуля: его заполняет set_performer при взятии заказа
    if (!isContainer(target)) {
        throw new ApiError(
            `${field} value for element key${String(path[0])} for ${verb} not array`,
        )
    }

    let cursor: Record<string, unknown> = target
    let allowed: unknown = validKeys
    let checking = true

    for (let i = 0; i < path.length; i++) {
        const key = String(path[i])

        if (checking) {
            if (!isPlainObject(allowed) || !(key in allowed)) {
                throw new ApiError(`wrong ${field} element keys for ${verb}`)
            }
            allowed = allowed[key]
            // true у ключа означает «ниже можно всё»
            if (allowed === true) checking = false
        }

        if (i === path.length - 1) {
            if (operator === '=') {
                cursor[key] = element[2]
            } else {
                const list = Array.isArray(cursor[key]) ? (cursor[key] as unknown[]) : []
                list.push(element[2])
                cursor[key] = list
            }
            return
        }

        if (cursor[key] === undefined) cursor[key] = {}
        // Спускаться можно и в список: в PHP is_array покрывает и списки, и
        // словари, поэтому путь вида [..., 'breaks', '0', 'ended'] боевой
        // бэкенд принимает
        if (!isContainer(cursor[key])) {
            throw new ApiError(`${field} value for element key${key} for ${verb} not array`)
        }

        cursor = cursor[key] as Record<string, unknown>
    }
}

/**
 * Применить список правок к сохранённому значению.
 * Возвращает новый объект, исходный не меняется.
 */
export function applyOptionPatch(
    stored: Record<string, unknown> | null,
    patch: unknown,
    validKeys: ValidKeys,
    field: string,
): Record<string, unknown> {
    if (!Array.isArray(patch)) throw new ApiError(`${field} not array`)

    // null здесь — не пустой объект, а незаполненное поле: правку в него
    // положить нельзя, см. проверку в applyOne
    const next = stored === null ?
        (null as unknown as Record<string, unknown>) :
        (JSON.parse(JSON.stringify(stored)) as Record<string, unknown>)

    for (const element of patch) applyOne(next, element, validKeys, field)
    return next
}
