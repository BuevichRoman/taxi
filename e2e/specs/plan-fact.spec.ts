import { test, expect, mock, advanceClock, DEMO_ORDER_ID, evidenceStep } from '../fixtures'

/**
 * ТЗ-001: итоговая таблица сверяет план и факт, а отклонение имеет знак.
 * Время двигается часами мока: 2 ч работы + 90 мин перерыва + 1 ч работы.
 * План: 6 ч всего, 5 ч работы, 1 ч перерыва.
 * Факт: 4 ч 30 мин всего, 3 ч работы, 1 ч 30 мин перерыва.
 */

const startBreak = '.order_break-btn'
const endOrder = '.order_take-order-btn'
const confirm = '.breaks-confirm_actions button'

test.beforeEach(async () => {
  await mock.reset()
})

test('итоговая таблица показывает отклонения плана и факта со знаком', async ({ nannyPage: page }, testInfo) => {
  await evidenceStep(
    page, testInfo, 1,
    'Отработать первые два часа',
    'Заказ остаётся активным; прошло 2 часа рабочего времени.',
    'Часы мока сдвинуты на 2 часа, заказ активен.',
    async () => {
      await page.goto(`/driver-order/${DEMO_ORDER_ID}`)
      await advanceClock(page, 2 * 60 * 60)
      await expect(page.locator(startBreak)).toBeVisible()
    },
  )

  await evidenceStep(
    page, testInfo, 2,
    'Зафиксировать перерыв длительностью 90 минут',
    'Перерыв завершён и отображается отдельной записью.',
    'Перерыв длительностью 90 минут сохранён.',
    async () => {
      await page.locator(startBreak).click()
      await confirm.first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')
      await advanceClock(page, 90 * 60)
      await page.locator(endOrder).first().click()
      await confirm.first().click()
      await expect(page.locator('.breaks_state-label')).toHaveText('Работа')
      await expect(page.locator('.breaks_item')).toHaveCount(1)
    },
  )

  await evidenceStep(
    page, testInfo, 3,
    'Завершить заказ после ещё одного часа работы',
    'Итоговая таблица показывает отрицательное отклонение по общему и рабочему времени и положительное по перерывам.',
    'Итог: всего −1 ч 30 мин; работа −2 ч 0 мин; перерывы +30 мин.',
    async () => {
      await advanceClock(page, 60 * 60)
      await page.locator(endOrder).first().click()
      await confirm.first().click()
      await expect(page.locator('.breaks_summary')).toBeVisible()

      const rows = page.locator('.breaks_summary tbody tr')
      await expect(rows.nth(0).locator('td').nth(3)).toHaveText('−1 ч 30 мин')
      await expect(rows.nth(1).locator('td').nth(3)).toHaveText('−2 ч 0 мин')
      await expect(rows.nth(2).locator('td').nth(3)).toHaveText('+30 мин')
    },
  )
})
