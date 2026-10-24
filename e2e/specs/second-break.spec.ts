import { test, expect, mock, DEMO_ORDER_ID } from '../fixtures'

/**
 * ТЗ-001 п. 14: нельзя начать второй перерыв, пока первый не завершён.
 * Отдельный файл — чтобы не затрагивать существующие сценарии перерывов.
 */

test.beforeEach(async () => {
  await mock.reset()
})

test('нельзя начать второй перерыв, пока первый открыт', async ({ nannyPage: page }) => {
  await page.goto(`/driver-order/${DEMO_ORDER_ID}`)

  const startBreak = page.locator('.order_break-btn')
  const confirm = page.locator('.breaks-confirm_actions button')

  await expect(startBreak).toBeVisible()
  await startBreak.click()
  await confirm.first().click()

  await expect(page.locator('.breaks_state-label')).toHaveText('Перерыв')

  // Пока перерыв открыт, действие его начала недоступно: повторный запуск
  // не должен создавать второй интервал в фактическом выполнении.
  await expect(startBreak).toHaveCount(0)

  const snapshot = await mock.orders()
  expect(snapshot.status).toBe('ok')
  const order = snapshot.data.find((item: any) => String(item.b_id) === DEMO_ORDER_ID)
  expect(order).toBeTruthy()

  const execution = order.drivers?.[0]?.c_options?.c_execution
  expect(execution?.actual?.breaks).toHaveLength(1)
  expect(execution.actual.breaks[0].ended).toBeNull()
})
