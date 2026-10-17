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
      // Не сохраняем снимок в состоянии загрузки: ждём стабилизации DOM и картинок,
      // но не блокируем отчёт, если конкретный экран не становится idle.
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {})
      await page.locator('body').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      // SPA may have completed navigation before React finished rendering. Wait
      // for a real app root child and two paint frames before capturing.
      await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
      // Wait for known loading overlays/spinners to disappear. A fixed delay
      // alone is not sufficient when API requests or React rendering are slow.
      const loadingIndicators = page.locator(
        '[aria-busy="true"], [role="progressbar"], .MuiCircularProgress-root, .MuiBackdrop-root, .loading, .loader, .spinner, [data-testid*="loading" i]'
      )
      await loadingIndicators.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(250)
      await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        if (document.fonts?.ready) await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
        await Promise.race([
          Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
      }).catch(() => {})
      const visualState = await page.evaluate(() => {
        const body = document.body
        const text = (body?.innerText || '').trim()
        const visibleLoading = Array.from(document.querySelectorAll(
          '[aria-busy="true"], [role="progressbar"], .MuiCircularProgress-root, .MuiBackdrop-root, .loading, .loader, .spinner, [data-testid*="loading" i]'
        )).some((el) => {
          const style = getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
        })
        return { textLength: text.length, visibleLoading, title: document.title }
      }).catch(() => ({ textLength: 0, visibleLoading: true, title: '' }))
      // Compare capture paths in the same run. CI reports success even when
      // the compositor returns an all-black PNG, so the artifact is inspected
      // by pixel content after the run rather than treating a successful call
      // as proof of a valid screenshot.
      // Capture can succeed at protocol level while Chromium returns an all-black
      // PNG (~5.8 KB for this 1280x720 viewport). Retry using independent paths;
      // known good app screenshots are substantially larger. Never replace a bad
      // image with a placeholder: if every attempt fails, attach the final real
      // capture and explicit diagnostics.
      const captureModes = [
        'playwright-page-screenshot',
        'playwright-body-screenshot',
        'cdp-fromSurface-true',
        'cdp-fromSurface-false',
        'cdp-default-options',
      ]
      let captureMode = captureModes[0]
      let screenshot = Buffer.alloc(0)
      let captureError: string | null = null
      const captureAttempts: Array<{ mode: string; bytes: number; error: string | null }> = []
      const captureWithMode = async (mode: string): Promise<Buffer> => {
        if (mode === 'playwright-page-screenshot') {
          return page.screenshot({ type: 'png', animations: 'disabled' })
        }
        if (mode === 'playwright-body-screenshot') {
          return page.locator('body').screenshot({ type: 'png', animations: 'disabled' })
        }
        const session = await page.context().newCDPSession(page)
        try {
          const options = mode === 'cdp-fromSurface-false'
            ? { format: 'png' as const, fromSurface: false, captureBeyondViewport: false }
            : mode === 'cdp-default-options'
              ? { format: 'png' as const }
              : { format: 'png' as const, fromSurface: true, captureBeyondViewport: false }
          const result = await session.send('Page.captureScreenshot', options)
          return Buffer.from(result.data, 'base64')
        } finally {
          await session.detach().catch(() => {})
        }
      }
      for (const mode of captureModes) {
        captureMode = mode
        try {
          const candidate = await captureWithMode(mode)
          captureAttempts.push({ mode, bytes: candidate.length, error: null })
          screenshot = candidate
          captureError = null
          // In this report a black 1280x720 PNG is about 5.8 KB; valid screens
          // have been >70 KB. Use a conservative threshold and try another path.
          if (candidate.length >= 20000) break
          captureError = `Screenshot looks suspiciously small (${candidate.length} bytes); trying next capture mode`
        } catch (error) {
          captureError = error instanceof Error ? error.message : String(error)
          captureAttempts.push({ mode, bytes: 0, error: captureError })
        }
      }
      const captureLooksValid = screenshot.length >= 20000
      const captureDiagnostics = await page.evaluate(() => {
        const root = document.querySelector('#root')
        const body = document.body
        const inspect = (element: Element | null) => {
          if (!element) return null
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            tag: element.tagName,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            backgroundColor: style.backgroundColor,
            color: style.color,
            childCount: element.childElementCount,
          }
        }
        return {
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          root: inspect(root),
          body: inspect(body),
          textLength: (body?.innerText || '').trim().length,
          readyState: document.readyState,
        }
      }).catch(() => null)
      await testInfo.attach(`step-${number}-capture-diagnostics.json`, {
        body: Buffer.from(JSON.stringify({
          captureMode,
          captureBytes: screenshot.length,
          captureError,
          captureLooksValid,
          captureAttempts,
          ...visualState,
          captureDiagnostics,
        }, null, 2)),
        contentType: 'application/json',
      })
      await testInfo.attach(`step-${number}-screenshot.png`, {
        body: screenshot,
        contentType: 'image/png',
      })
      await testInfo.attach(`step-${number}-visual-state.json`, {
        body: Buffer.from(JSON.stringify({ ...visualState, captureMode, captureLooksValid, captureAttempts }, null, 2)),
        contentType: 'application/json',
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
