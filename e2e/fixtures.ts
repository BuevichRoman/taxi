import { test as base, expect, type Page, type TestInfo } from '@playwright/test'

/**
 * Вход в приложение няни для прогона.
 *
 * Обычная авторизация против мока не поднимается: она идёт через код из
 * СМС. Приложение восстанавливает сессию из localStorage (`state.user.tokens`,
 * см. `src/state/user/sagas.ts`), туда и кладём токены мока — он принимает
 * любые.
 */
export const NANNY_TOKENS = { token: 'mock-token', u_hash: 'mock-u-hash' }

/** Демонстрационный заказ, который мок заводит при старте: работа уже идёт */
export const DEMO_ORDER_ID = '1'

/**
 * И приложение, и API отвечают с одного адреса: статику отдаёт
 * `e2e/static-server.mjs`, а запросы к API он проксирует в мок. Так же
 * устроено боевое размещение
 */
const APP_URL = 'http://localhost:4173'
const MOCK_API = `${APP_URL}/api/v1`

/**
 * Справочники тенанта приложение грузит отдельным скриптом с боевого хоста
 * (`applyConfigName` в `src/config.ts`, адрес там зашит). В прогоне вместо
 * него отдаём срез из мока, а прочие внешние адреса закрываем: тест не
 * должен зависеть от сети
 */
async function serveTenantConfig(page: Page): Promise<void> {
  const response = await fetch(`${MOCK_API}/data`, { method: 'POST' })
  // Ответ мока — { data: { version, default_lang, ..., data: справочники } },
  // а скрипт конфига кладёт в window.data сами справочники
  const { data: { data: reference } } = await response.json()

  // Порог видимости перерыва (ТЗ п. 20) — константа тенанта, в срезе мока
  // её нет. Задаём явно, чтобы проверка короткого перерыва не зависела от
  // запасного значения в коде
  reference.site_constants = {
    ...reference.site_constants,
    min_visible_break_duration: { value: '60' },
  }

  // Порядок важен: у Playwright побеждает обработчик, добавленный позже,
  // поэтому общий запрет ставится первым, а подмена конфига — поверх него
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())

  await page.route('https://ibronevik.ru/taxi/cache/**', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.data = ${JSON.stringify(reference)}`,
    })
  })
}

/** Управление часами и состоянием мока — маршруты `_test`, в боевом API их нет */
export const mock = {
  async reset(): Promise<void> {
    await fetch(`${APP_URL}/_test/reset`, { method: 'POST' })
  },
  /** Сдвинуть часы мока вперёд: шестичасовой заказ прогоняется за секунды */
  async advance(seconds: number): Promise<void> {
    await fetch(`${APP_URL}/_test/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    })
  },
  async orders(): Promise<any> {
    const res = await fetch(`${APP_URL}/_test/orders`)
    return res.json()
  },
}

/**
 * Сдвинуть часы мока и дать приложению их увидеть.
 *
 * Свои часы приложение сверяет по заголовку `Date` очередного ответа
 * (`installServerClock`), а экран заказа сам ничего не опрашивает, поэтому
 * после сдвига страницу нужно перезагрузить — иначе перерыв останется
 * нулевым, сколько бы часов мы ни прокрутили
 */
export async function advanceClock(page: Page, seconds: number): Promise<void> {
  await mock.advance(seconds)
  await page.reload()
}

export const test = base.extend<{ nannyPage: Page }>({
  nannyPage: async ({ page }, use) => {
    await page.addInitScript((tokens) => {
      window.localStorage.setItem('state.user.tokens', JSON.stringify(tokens))
    }, NANNY_TOKENS)

    await serveTenantConfig(page)
    await use(page)
  },
})

export { expect }


/**
 * Выполняет один проверяемый шаг и сохраняет самодостаточное доказательство:
 * действие, ожидание, фактический результат, время шага, серверные (мок-)часы
 * и скриншот. Ошибка не подавляется: Playwright-тест остаётся FAIL.
 */
export async function evidenceStep(
  page: Page,
  testInfo: TestInfo,
  number: number,
  action: string,
  expected: string,
  actualOnPass: string,
  run: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now()
  let status: 'PASS' | 'FAIL' = 'PASS'
  let actual = actualOnPass
  let errorText: string | undefined

  try {
    await base.step(`${number}. ${action}`, run)
  } catch (error) {
    status = 'FAIL'
    errorText = error instanceof Error ? error.message : String(error)
    actual = errorText
    throw error
  } finally {
    const elapsedMs = Date.now() - startedAt
    let simulatedTime: string | null = null
    try {
      const response = await fetch(`${APP_URL}/api/v1/data`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      })
      const dateHeader = response.headers.get('date')
      simulatedTime = dateHeader ? new Date(dateHeader).toISOString() : null
    } catch {
      // Снимок и результат шага важнее необязательного значения часов.
    }

    try {
      const screenshot = await page.screenshot({ animations: 'disabled' })
      await testInfo.attach(`step-${number}-screenshot.png`, {
        body: screenshot,
        contentType: 'image/png',
      })
    } catch {
      // При закрытой странице скриншот может быть недоступен; ошибка шага
      // остаётся в JSON-доказательстве и в обычном результате Playwright.
    }

    await testInfo.attach(`step-${number}-details.json`, {
      body: Buffer.from(JSON.stringify({
        number, action, expected, actual, status, elapsedMs, simulatedTime, error: errorText ?? null,
      }, null, 2)),
      contentType: 'application/json',
    })
  }
}
