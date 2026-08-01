import { t, TRANSLATION } from '../../../localization'

/**
 * Запасные тексты для перерывов.
 *
 * Тексты интерфейса хранятся в справочнике lang_vls серверного конфига, и
 * при отсутствии ключа t() возвращает строку 'Error'. Ключей перерывов там
 * пока нет, поэтому до их добавления показываем эти значения.
 *
 * Как только строки появятся в конфиге, они начнут использоваться
 * автоматически, и этот файл можно будет удалить.
 */
const FALLBACK: Record<string, string> = {
  [TRANSLATION.BREAK_START]: 'Начать перерыв',
  [TRANSLATION.BREAK_END]: 'Продолжить работу',
  [TRANSLATION.BREAK_START_CONFIRM]:
    'Начать перерыв? Во время перерыва оплачиваемое время начисляться не будет.',
  [TRANSLATION.BREAK_END_CONFIRM]: 'Завершить перерыв и продолжить выполнение заказа?',
  [TRANSLATION.BREAK_ON_SINCE]: 'На перерыве с',
  [TRANSLATION.BREAKS_LIST]: 'Перерывы',
  [TRANSLATION.BREAKS_NONE]: 'Перерывов не было',
  [TRANSLATION.TIME_WORK]: 'Рабочее время',
  [TRANSLATION.TIME_BREAKS]: 'Перерывы',
  [TRANSLATION.TIME_TOTAL]: 'Общее время заказа',
  [TRANSLATION.STATE_WORKING]: 'Работа',
  [TRANSLATION.STATE_ON_BREAK]: 'Перерыв',
  [TRANSLATION.PLAN_SHORT]: 'План',
  [TRANSLATION.STATE_FINISHED]: 'Заказ завершён',
  [TRANSLATION.FACT_SHORT]: 'Факт',
  [TRANSLATION.DEVIATION]: 'Отклонение',
  [TRANSLATION.PRICE_PRELIMINARY]: 'Предварительная стоимость',
  [TRANSLATION.PRICE_FINAL]: 'Итоговая стоимость',
  [TRANSLATION.BREAK_ALREADY_ACTIVE]: 'Перерыв уже идёт',
  [TRANSLATION.BREAK_NOT_ACTIVE]: 'Перерыв не начат',
  [TRANSLATION.ORDER_ALREADY_FINISHED]: 'Заказ уже завершён',
}

/** Как t(), но с запасным текстом вместо 'Error' для ключей перерывов */
export const tBreak = (id: string): string => {
  const result = t(id)
  return result === 'Error' ? FALLBACK[id] ?? id : result
}
