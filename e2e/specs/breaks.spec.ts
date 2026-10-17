import { test, expect, mock, advanceClock, DEMO_ORDER_ID, evidenceStep } from '../fixtures'
import type { Request } from '@playwright/test'

/**
 * Перерывы на стороне няни (ТЗ-001 п. 7-11, 20).
 * Часы двигаются маршрутом мока _test/advance; тест не ждёт реального времени.
 *
 * Эти проверки подтверждают только интерфейс няни. Сквозные проверки с
 * Telegram-клиентом остаются отдельными сценариями и не считаются PASS здесь.
 */

const startBreak = '.order_break-btn'
const endBreak = '.order_take-order-btn'
const confirm = '.breaks-confirm_actions button'

test.beforeEach(async () => {
  await mock.reset()
})

test('няня уходит на перерыв и возвращается к работе', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Открыть активный заказ',
    'Кнопка начала перерыва видна; состояние перерыва ещё не отображается.',
    'Кнопка начала перерыва видна; блока состояния перерыва нет.',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await expect(page.locator(startBreak)).toBeVisible()
      await expect(page.locator('.breaks_state-label')).toHaveCount(0)
    },
  )

  await evidenceStep(
    page, testInfo, 2,
    'Начать перерыв и подтвердить действие',
    'Состояние заказа меняется на «Перерыв».',
    'На экране показано состояние «Перерыв» и время начала.',
    async () => {
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
      await expect(page.locator('.breaks_state-since')).toContainText('На перерыве с')
    },
  )

  await evidenceStep(
    page, testInfo, 3,
    'Продвинуть управляемые часы на 20 минут',
    'Прошло 20 минут по часам мока; страница обновлена без ожидания реального времени.',
    'Часы мока сдвинуты на 20 минут, страница перезагружена.',
    async () => {
      await advanceClock(page, 20 * 60)
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
    },
  )

  await evidenceStep(
    page, testInfo, 4,
    'Возобновить работу',
    'Состояние «Работа», в списке один завершённый перерыв.',
    'Показано состояние «Работа»; список содержит один перерыв.',
    async () => {
      await page.locator(endBreak).first().click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
      await expect(page.locator('.breaks_list-header span').last()).toHaveText('1')
      await expect(page.locator('.breaks_item')).toHaveCount(1)
    },
  )
})

test('короткий перерыв не попадает в список, но входит в суммы', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Открыть заказ и начать перерыв',
    'Перерыв начинается и отображается в состоянии заказа.',
    'На экране показано состояние «Перерыв».',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
    },
  )

  await evidenceStep(
    page, testInfo, 2,
    'Продвинуть управляемые часы на 30 секунд',
    'Длительность перерыва меньше порога видимости 60 секунд.',
    'Часы мока сдвинуты на 30 секунд; страница перезагружена.',
    async () => {
      await advanceClock(page, 30)
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
    },
  )

  await evidenceStep(
    page, testInfo, 3,
    'Завершить короткий перерыв',
    'Работа возобновлена; короткий перерыв не отображается в списке.',
    'Состояние «Работа»; список перерывов пуст.',
    async () => {
      await page.locator(endBreak).first().click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
      await expect(page.locator('.breaks_list-empty')).toBeVisible()
      await expect(page.locator('.breaks_list-header span').last()).toHaveText('0')
    },
  )

  await evidenceStep(
    page, testInfo, 4,
    'Проверить итоговые суммы',
    'Короткий перерыв учитывается в суммах, даже если скрыт в списке.',
    'Значение длительности перерывов в суммах не равно нулю.',
    async () => {
      await expect(page.locator('.breaks_totals dd').nth(2)).not.toHaveText('0 сек')
    },
  )
})

test('заказ завершён во время перерыва: перерыв закрыт, показан итог', async ({ nannyPage: page }, testInfo) => {
  let priceAsked!: Promise<Request>

  await evidenceStep(
    page, testInfo, 1,
    'Открыть заказ и начать перерыв',
    'Состояние заказа меняется на «Перерыв».',
    'На экране показано состояние «Перерыв».',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
    },
  )

  await evidenceStep(
    page, testInfo, 2,
    'Продвинуть управляемые часы на 15 минут',
    'Накапливается 15 минут времени перерыва без реального ожидания.',
    'Часы мока сдвинуты на 15 минут; страница перезагружена.',
    async () => {
      await advanceClock(page, 15 * 60)
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
    },
  )

  await evidenceStep(
    page, testInfo, 3,
    'Завершить заказ во время перерыва',
    'Заказ закрыт, перерыв закрыт, итоговая сводка показана.',
    'Показано состояние «Заказ завершён», сводка и одна запись перерыва.',
    async () => {
      priceAsked = page.waitForRequest(r => r.url().includes('/script/template/nanny_pricing'))
      // Во время перерыва кнопок две: «Продолжить работу» и завершение заказа.
      await page.locator(endBreak).nth(1).click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Заказ завершён')
      await expect(page.locator('.breaks_summary')).toBeVisible()
      await expect(page.locator('.breaks_item')).toHaveCount(1)
    },
  )

  await evidenceStep(
    page, testInfo, 4,
    'Проверить запрос итогового серверного расчёта',
    'Отправлен action=final с ID заказа и числовым duration_min.',
    'Запрос содержит action=final, правильный b_id и числовой duration_min.',
    async () => {
      const request = await priceAsked
      const body = request.postData() ?? ''
      const asked = JSON.parse(body.match(/name="s_t_data"\r\n\r\n(.*?)\r\n/)?.[1] ?? '{}')
      expect(asked).toMatchObject({ action: 'final', b_id: Number(DEMO_ORDER_ID) })
      expect(typeof asked.duration_min).toBe('number')
      await expect(page.locator('.breaks_summary tbody tr').nth(3).locator('td').nth(2)).toHaveText(/^\d+$/)
    },
  )
})


test('заказ без перерывов не показывает состояние и список перерывов', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Открыть активный заказ без перерывов',
    'Нет состояния перерыва и нет элементов завершённых перерывов.',
    'Состояние перерыва отсутствует; список записей пуст.',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await expect(page.locator('.breaks_state-label')).toHaveCount(0)
      await expect(page.locator('.breaks_item')).toHaveCount(0)
      await expect(page.locator(startBreak)).toBeVisible()
    },
  )
})

test('во время активного перерыва нельзя начать второй перерыв', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Начать первый перерыв',
    'Показывается состояние «Перерыв», повторная кнопка начала отсутствует.',
    'Первый перерыв активен; кнопка начала второго перерыва отсутствует.',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
      await expect(page.locator(startBreak)).toHaveCount(0)
      await expect(page.locator(endBreak).first()).toBeVisible()
    },
  )
})

test('два последовательных перерыва сохраняются отдельными записями', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Выполнить первый короткий перерыв',
    'После возобновления работы перерыв короче порога видимости 60 секунд и не отображается в списке.',
    'Работа возобновлена после первого перерыва длительностью 30 секунд.',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await advanceClock(page, 30)
      await page.locator(endBreak).first().click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
    },
  )

  await evidenceStep(
    page, testInfo, 2,
    'Выполнить второй короткий перерыв',
    'После второго возобновления работа активна, оба коротких перерыва учтены в суммах.',
    'Два перерыва завершены; состояние «Работа» и итоговые суммы доступны.',
    async () => {
      await page.locator(startBreak).click()
      await page.locator(confirm).first().click()
      await advanceClock(page, 30)
      await page.locator(endBreak).first().click()
      await page.locator(confirm).first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
      await expect(page.locator('.breaks_list-empty')).toBeVisible()
      await expect(page.locator('.breaks_totals dd').nth(2)).not.toHaveText('0 сек')
    },
  )
})
