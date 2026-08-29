/**
 * HTTP-слой мока: маршруты и разбор запросов.
 *
 * Эмулируется только то, что нужно для перерывов (раздел 2 контракта).
 * Остальной API заказа не воспроизводится — см. README.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import express from 'express'
import multer from 'multer'

import { PORT } from './config.ts'
import { bookingBase, CLIENT, driverEntry, NANNY, TOKENS, USERS } from './fixtures.ts'
import {
    applyUserData,
    createUser,
    findUserByIdField,
    findUserById,
    resetUsers,
} from './users.ts'
import {
    apiDate,
    completeOrder,
    startWork,
    type Order,
} from './store.ts'
import {
    ApiError,
    applyOptionPatch,
    B_OPTIONS_VALID_KEYS,
    C_OPTIONS_VALID_KEYS,
} from './options.ts'

// --- часы -------------------------------------------------------------------

/**
 * Смещение относительно реальных часов. Позволяет прогонять многочасовые
 * сценарии за секунды через POST /_test/advance.
 */
let clockOffsetMs = 0
const now = (): Date => new Date(Date.now() + clockOffsetMs)

// --- справочники ------------------------------------------------------------

/**
 * Срез публичного конфига тенанта. Лежит файлом, а не скачивается на старте:
 * мок должен работать без сети и одинаково от прогона к прогону.
 */
const API_DATA = JSON.parse(
    readFileSync(fileURLToPath(new URL('./api-data.json', import.meta.url)), 'utf8'),
) as { version: string; data: Record<string, unknown> }

// --- хранилище --------------------------------------------------------------

const orders = new Map<string, Order>()
let nextId = 1

function getOrder(id: unknown): Order {
    const key = String(id ?? '')
    const order = orders.get(key)
    if (!order) throw new ApiError(`booking ${key} not found`)
    return order
}

/** Поля заказа приходят JSON-строкой в поле `data` — как в боевом API */
function parseDataEnvelope(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string' || raw.trim() === '') return {}
    try {
        const parsed: unknown = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

// --- приложение -------------------------------------------------------------

const app = express()
const api = express.Router()
const form = multer().none()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Журнал запросов: по нему видно, какого метода моку не хватает.
// Отключается переменной MOCK_QUIET=1
if (process.env.MOCK_QUIET !== '1') {
    app.use((req, _res, next) => {
        console.log(`${req.method} ${req.originalUrl}`)
        next()
    })
}

// Заголовок `Date` — по часам мока, а не по системным: приложение няни
// сверяет по нему свои часы (`installServerClock`), и после сдвига через
// `_test/advance` оно должно увидеть новое время, иначе перерыв на экране
// останется нулевым
app.use((_req, res, next) => {
    res.set('Date', now().toUTCString())
    next()
})

// Клиенты работают с других портов, поэтому CORS открыт полностью —
// это мок для разработки, наружу он не выставляется.
app.use((_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Headers', '*')
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    next()
})
app.options(/.*/, (_req, res) => {
    res.sendStatus(204)
})

/**
 * Заказ в том виде, в каком его ждут клиенты: перерывы внутри `b_options`,
 * поверх обычных полей заказа, и назначенный исполнитель в `drivers`.
 * Оболочка ответа повторяет боевую — заказ лежит в `data.booking[b_id]`,
 * статус `success`.
 */
const bookingPayload = (order: Order, at: Date) => {
    const base = bookingBase(order.b_id, apiDate(at))
    return {
        ...base,
        b_id: order.b_id,
        // 4 — «Выполнен», 2 — «Одобрен», как в справочнике booking_states
        b_state: order.finished ? '4' : '2',
        b_options: { ...base.b_options, ...order.b_options },
        drivers: [
            {
                ...driverEntry(order.started_at),
                c_completed: order.ended_at,
                // Факт лежит здесь: писать в b_options исполнителю нельзя
                c_options: order.c_options,
            },
        ],
    }
}

// Времени сервера в ответе нет — его не отдаёт и боевой API (вопрос 7).
// Клиент считает таймеры от своих часов в фиксированном поясе.
const ok = (res: express.Response, order: Order) => {
    const at = now()
    res.json({
        status: 'success',
        data: {
            booking: { [order.b_id]: bookingPayload(order, at) },
        },
    })
}

/**
 * Версия кеша. Клиент запрашивает её перед загрузкой справочников и без
 * ответа не доходит до отрисовки.
 */
api.get('/', (_req, res) => {
    res.json({ 'cache version': API_DATA.version })
})

/**
 * Справочники тенанта: langs, lang_vls, site_constants и прочее.
 * Бот загружает их при старте и без них не поднимается.
 *
 * Содержимое — срез публичного конфига тенанта
 * (https://ibronevik.ru/taxi/cache/data_children.js), см. README.
 */
api.post('/data', form, (_req, res) => {
    res.json({ status: 'success', data: API_DATA })
})

// --- авторизация ------------------------------------------------------------
//
// Настоящая проверка не эмулируется: любой логин и пароль подходят. Нужна
// только чтобы дойти до экрана заказа, все действия выполняются от няни.

// `/auth` зовёт приложение няни, `/auth/login` — админская авторизация бота
// (`APIManager.loginAdmin`). Ответ один и тот же: `auth_hash` и `auth_user`
// верхним уровнем, дальше клиент идёт за токеном на `/token`.
api.post(['/auth', '/auth/login'], form, (_req, res) => {
    res.json({ status: 'success', auth_hash: 'mock-auth-hash', auth_user: NANNY })
})

api.post('/token', form, (_req, res) => {
    res.json({ status: 'success', data: TOKENS })
})

api.post('/user/authorized', form, (_req, res) => {
    res.json({ status: 'success', data: { user: { [NANNY.u_id]: NANNY } } })
})

/**
 * Регистрация. Открыта без авторизации, как и на боевом стенде.
 * Поля профиля приходят JSON-строкой в `data`.
 */
api.post('/register', form, (req, res) => {
    const body = req.body as Record<string, unknown>
    const user = createUser({
        u_role: typeof body['u_role'] === 'string' ? body['u_role'] : undefined,
        u_name: typeof body['u_name'] === 'string' ? body['u_name'] : undefined,
        ref_code: typeof body['ref_code'] === 'string' ? body['ref_code'] : undefined,
        u_tg: typeof body['u_tg'] === 'string' ? body['u_tg'] : undefined,
        u_wa: typeof body['u_wa'] === 'string' ? body['u_wa'] : undefined,
        chatId: typeof body['chatId'] === 'string' ? body['chatId'] : undefined,
        data: parseDataEnvelope(body['data']),
    })
    res.json({ status: 'success', data: { u_id: user.u_id, user: { [user.u_id]: user } } })
})

/**
 * Профиль по идентификатору канала: чтение, если `data` нет, иначе правка.
 * Незарегистрированный пользователь — ошибка: по ней бот понимает, что нужно
 * провести регистрацию.
 */
api.post('/user', form, (req, res) => {
    const body = req.body as Record<string, unknown>
    const user = findUserByIdField(body)
    if (!user) {
        res.json({ status: 'error', code: 'not_found', message: 'Пользователь не найден' })
        return
    }

    if (typeof body['data'] === 'string') applyUserData(user, parseDataEnvelope(body['data']))
    res.json({ status: 'success', data: { user: { [user.u_id]: user } } })
})

/**
 * Пользователи по идентификаторам. Правка по `u_id` идёт сюда же — так бот
 * меняет рефкод при переводе учётки в тестовый режим.
 */
api.post('/user/:ids', form, (req, res) => {
    const requested = String(req.params.ids ?? '').split(',')
    const body = req.body as Record<string, unknown>

    if (typeof body['data'] === 'string' && requested.length === 1) {
        const target = findUserById(requested[0]!)
        if (target) {
            applyUserData(target, parseDataEnvelope(body['data']))
            res.json({ status: 'success', data: { user: { [target.u_id]: target } } })
            return
        }
    }

    const user: Record<string, unknown> = {}
    for (const id of requested) {
        user[id] = findUserById(id) ?? USERS[id] ?? CLIENT
    }
    res.json({ status: 'success', data: { user } })
})

// --- заказы -----------------------------------------------------------------

/**
 * Создание заказа, либо список заказов — боевой API различает их по
 * `array_type`, здесь так же. Плановые перерывы — раздел 4.3 контракта.
 */
api.post('/drive', form, (req, res) => {
    const body = req.body as Record<string, unknown>

    if (body['array_type'] === 'list') {
        const at = now()
        res.json({
            status: 'success',
            code: '200',
            data: {
                server_time: apiDate(at),
                booking: [...orders.values()].map(o => bookingPayload(o, at)),
            },
        })
        return
    }

    const id = String(nextId++)

    // Оба клиента складывают поля заказа в JSON-строку `data`; отдельные
    // поля формы поддерживаем как запасной вариант для ручных проверок
    const payload = { ...parseDataEnvelope(body['data']), ...body }

    // Заказ создаёт заказчик, поэтому b_options он задаёт целиком и обычным
    // объектом — список правок нужен только действию edit. Незнакомые ключи
    // боевой бэкенд отбивает, заказ при этом не создаётся вовсе
    const options =
        typeof payload['b_options'] === 'object' && payload['b_options'] !== null
            ? (payload['b_options'] as Record<string, unknown>)
            : {}

    const wrong = Object.keys(options).filter(key => !(key in B_OPTIONS_VALID_KEYS))
    if (wrong.length > 0) {
        throw new ApiError(`wrong b_options keys: ${wrong.join(',')}`)
    }

    const order: Order = {
        b_id: id,
        performer_u_id: typeof body['performer_u_id'] === 'string' ?
            body['performer_u_id'] :
            NANNY.u_id,
        b_options: options,
        c_options: null,
        started_at: null,
        ended_at: null,
        finished: false,
    }

    orders.set(id, order)
    ok(res, order)
})

/** Рейсы к перерывам отношения не имеют, отвечаем пустым списком. */
api.post('/trip/get', form, (_req, res) => {
    res.json({ status: 'success', code: '200', data: { trip: [] } })
})

/** Свободные заказы и архив — пустые, но маршруты нужны, иначе клиент падает. */
api.post('/drive/now', form, (_req, res) => {
    res.json({ status: 'success', code: '200', data: { booking: [] } })
})
api.post('/drive/archive', form, (_req, res) => {
    res.json({ status: 'success', code: '200', data: { booking: [] } })
})

/** Чтение заказа — этим пользуется опрос со стороны бота. */
api.get('/drive/get/:id', (req, res) => {
    ok(res, getOrder(req.params.id))
})

/**
 * `action=edit` — правка полей заказа списком правок.
 *
 * Разрешённые поля бэкенд собирает раздельно по ролям: заказчику доступен
 * `b_options`, исполнителю — только `c_options` (`models/api.php:10004-10052`).
 * Роль берём из `u_a_role`, как её присылает бот; без неё считаем, что
 * действует няня — все сценарии интерфейса идут от неё.
 */
function editOrder(
    order: Order,
    body: Record<string, unknown>,
    actor: string | undefined,
): void {
    const data = parseDataEnvelope(body['data'])
    const isClient = String(body['u_a_role'] ?? '') === '1'

    if (!isClient && actor !== undefined && actor !== order.performer_u_id) {
        throw new ApiError('user is not performer')
    }

    const affected: string[] = []

    if (data['c_options'] !== undefined) {
        if (isClient) throw new ApiError('allowed data not found')
        order.c_options = applyOptionPatch(
            order.c_options,
            data['c_options'],
            C_OPTIONS_VALID_KEYS,
            'c_options',
        )
        affected.push('c_options')
    }

    if (data['b_options'] !== undefined) {
        // Ровно то, обо что мы споткнулись: няне это поле недоступно
        if (!isClient) throw new ApiError('allowed data not found')
        order.b_options = applyOptionPatch(
            order.b_options,
            data['b_options'],
            B_OPTIONS_VALID_KEYS,
            'b_options',
        )
        affected.push('b_options')
    }

    if (affected.length === 0) throw new ApiError('allowed data not found')
}

/** Действия над заказом. Формат совпадает с боевым: action в теле запроса. */
api.post('/drive/get/:id', form, (req, res) => {
    const order = getOrder(req.params.id)
    const body = req.body as Record<string, unknown>
    const action = String(body['action'] ?? '')
    const actor = typeof body['u_id'] === 'string' ? body['u_id'] : undefined

    switch (action) {
        case 'set_start_state':
            startWork(order, now())
            break
        case 'set_complete_state':
            completeOrder(order, now())
            break
        case 'edit':
            editOrder(order, body, actor)
            break
        case '':
            break // чтение через POST, как это делает существующий клиент
        default:
            // Боевой бэкенд неизвестное действие не отвергает: разбор идёт
            // цепочкой if/elseif без ветки «иначе», и ответ уходит пустым с
            // кодом 200. Мок повторяет это дословно — на этом мы уже один
            // раз обожглись: интерфейс показывал успех, а записи не было
            res.json({})
            return
    }

    ok(res, order)
})

// Боевой адрес — https://ibronevik.ru/taxi/c/{тенант}/api/v1, поэтому те же
// маршруты доступны и по короткому пути, и с префиксом версии.
app.use('/api/v1', api)
app.use('/', api)

// --- служебные маршруты для прогона сценариев -------------------------------

app.post('/_test/reset', (_req, res) => {
    orders.clear()
    resetUsers()
    nextId = 1
    clockOffsetMs = 0
    seedUsers()
    seed()
    res.json({ status: 'ok' })
})

/** Сдвиг часов вперёд: POST /_test/advance {"seconds": 3600}. */
app.post('/_test/advance', (req, res) => {
    const body = req.body as Record<string, unknown>
    const seconds = Number(body['seconds'] ?? 0)
    if (!Number.isFinite(seconds)) {
        res.status(400).json({ status: 'error', message: 'seconds должно быть числом' })
        return
    }
    clockOffsetMs += seconds * 1000
    res.json({ status: 'ok', server_time: apiDate(now()) })
})

app.get('/_test/orders', (_req, res) => {
    const at = now()
    res.json({
        status: 'ok',
        server_time: apiDate(at),
        data: [...orders.values()].map(o => bookingPayload(o, at)),
    })
})

// --- ошибки -----------------------------------------------------------------

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
        // Формат из раздела 5 контракта. HTTP 200 — как в боевом API,
        // где ошибка передаётся в теле, а не кодом ответа.
        res.json({ status: 'error', code: err.code, message: err.message })
        return
    }
    res.status(500).json({ status: 'error', message: String(err) })
})

/**
 * Демонстрационный заказ: шесть часов, час планового перерыва, работа уже
 * начата — чтобы кнопка перерыва была доступна сразу после входа.
 */
/** Максимальные версии документов — с ними сверяется согласие пользователя */
function legalDocsVersions(): Record<string, string> {
    const constants = API_DATA.data['site_constants'] as
        | Record<string, { value?: unknown }>
        | undefined
    const raw = constants?.['bot_legal_docs']?.value
    if (typeof raw !== 'string') return {}

    const docs = JSON.parse(raw) as Record<string, { content?: Array<{ version?: number }> }>
    const versions: Record<string, string> = {}
    for (const [name, doc] of Object.entries(docs)) {
        const max = (doc.content ?? []).reduce((acc, item) => Math.max(acc, item.version ?? 0), 0)
        versions[name] = String(max)
    }
    return versions
}

/**
 * Зарегистрированный заказчик. Сценарии основного потока бота начинаются с
 * пользователя, который уже прошёл регистрацию и принял документы, — иначе
 * бот встречает его выбором языка.
 */
const SEEDED_CUSTOMER_TG = '9638908545'

function seedUsers(): void {
    createUser({
        u_role: '1',
        u_name: 'Ирина',
        u_tg: SEEDED_CUSTOMER_TG,
        data: { u_lang: '1', u_city: '1', u_details: { phone: '79990000002', birthYear: '1990' } },
        docsVersions: legalDocsVersions(),
    })
}

function seed(): void {
    const start = now()
    const id = String(nextId++)

    // План кладёт заказчик при создании заказа. Факта нет: няня ещё не
    // отметила ни одного перерыва, c_options пуст
    const order: Order = {
        b_id: id,
        performer_u_id: NANNY.u_id,
        b_options: {
            b_end_datetime: apiDate(new Date(start.getTime() + 6 * 3600_000)),
            b_execution: {
                schema_version: 1,
                estimate: {
                    started: apiDate(start),
                    ended: apiDate(new Date(start.getTime() + 6 * 3600_000)),
                    breaks: [
                        {
                            started: apiDate(new Date(start.getTime() + 2 * 3600_000)),
                            ended: apiDate(new Date(start.getTime() + 3 * 3600_000)),
                        },
                    ],
                    total_seconds: 21600,
                    work_seconds: 18000,
                    break_seconds: 3600,
                    billable_work_seconds: 18000,
                },
            },
        },
        // заказ уже взят: performers_price кладёт set_performer
        c_options: { performers_price: 0 },
        started_at: apiDate(start),
        ended_at: null,
        finished: false,
    }

    orders.set(id, order)
}

seedUsers()
seed()

app.listen(PORT, () => {
    console.log(`Мок API перерывов слушает http://localhost:${PORT}`)
    console.log(`  POST /drive                      создать заказ`)
    console.log(`  POST /drive/get/:id  action=...  set_start_state | set_break_start_state |`)
    console.log(`                                   set_break_end_state | set_complete_state`)
    console.log(`  GET  /drive/get/:id              прочитать заказ`)
    console.log(`  POST /_test/advance  {seconds}   сдвинуть часы вперёд`)
    console.log(`  POST /_test/reset                очистить состояние`)
})
