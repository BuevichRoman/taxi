import { test, expect, mock, advanceClock, DEMO_ORDER_ID } from '../fixtures'

/**
 * Перерывы на стороне няни (ТЗ-001 п. 7-11, 20).
 *
 * Часы двигаются маршрутом мока `_test/advance`: длительности получаются
 * настоящие, а прогон не ждёт реального времени.
 *
 * Про селекторы. Тексты блока перерывов приходят из `Breaks/texts.ts` и
 * всегда русские: ключей `wab_*` в справочнике тенанта пока нет. Остальной
 * интерфейс переводится и зависит от языка сервиса, поэтому общие кнопки
 * берутся по классам, а не по надписям.
 */

const startBreak = '.order_break-btn'
const endBreak = '.order_take-order-btn'
/** Первая кнопка в подтверждении — «Да» */
const confirm = '.breaks-confirm_actions button'

test.beforeEach(async () => {
  await mock.reset()
})

test('няня уходит на перерыв и возвращается к работе', async ({ nannyPage: page }) => {
  await page.goto(`/driver-order/${DEMO_ORDER_ID}`)

  // До первого перерыва факта нет, и блок не отрисован
  await expect(page.locator(startBreak)).toBeVisible()
  await expect(page.locator('.breaks_state-label')).toHaveCount(0)

  await page.locator(startBreak).click()
  await page.locator(confirm).first().click()

  await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
  await expect(page.locator('.breaks_state-since')).toContainText('На перерыве с')

  await advanceClock(page, 20 * 60)

  await page.locator(endBreak).first().click()
  await page.locator(confirm).first().click()

  await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
  await expect(page.locator('.breaks_list-header span').last()).toHaveText('1')
  await expect(page.locator('.breaks_item')).toHaveCount(1)
})

test('короткий перерыв не попадает в список, но входит в суммы', async ({ nannyPage: page }) => {
  await page.goto(`/driver-order/${DEMO_ORDER_ID}`)

  await page.locator(startBreak).click()
  await page.locator(confirm).first().click()
  await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')

  // Короче min_visible_break_duration — она равна минуте
  await advanceClock(page, 30)

  await page.locator(endBreak).first().click()
  await page.locator(confirm).first().click()

  await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
  await expect(page.locator('.breaks_list-empty')).toBeVisible()
  await expect(page.locator('.breaks_list-header span').last()).toHaveText('0')

  // В суммах он есть: перерывы перестали быть нулевыми
  await expect(page.locator('.breaks_totals dd').nth(2)).not.toHaveText('0 сек')
})

test('заказ завершён во время перерыва: перерыв закрыт, показан итог', async ({ nannyPage: page }) => {
  await page.goto(`/driver-order/${DEMO_ORDER_ID}`)

  await page.locator(startBreak).click()
  await page.locator(confirm).first().click()
  await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')

  await advanceClock(page, 15 * 60)

  // Во время перерыва кнопок с этим классом две: «Продолжить работу»
  // и завершение заказа. Нужна вторая
  await page.locator(endBreak).nth(1).click()

  await expect(page.locator('.breaks_state-label')).toHaveText('Заказ завершён')
  await expect(page.locator('.breaks_summary')).toBeVisible()
  await expect(page.locator('.breaks_item')).toHaveCount(1)
})
