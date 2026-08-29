/**
 * Форматы дат проекта.
 *
 * Вынесены из `tools/utils` отдельным модулем: тот тянет за собой хранилище
 * состояния и локализацию, поэтому импортировать из него один строковый
 * константный формат дорого — и невозможно в тестах, где приложение не
 * поднято. `tools/utils` эти же значения реэкспортирует, существующие
 * импорты работают как работали.
 *
 * Формат даты API — `2026-03-18 10:03:46+03:00`, через пробел и с
 * обязательным смещением: бэкенд разбирает дату регулярным выражением, и
 * ISO с `T` он отвергает.
 */

export const dateFormat = 'YYYY-MM-DD HH:mm:ssZ'
export const dateShowFormat = 'HH:mm DD-MM'
export const dateFormatDate = 'DD-MM'
export const dateFormatTime = 'HH:mm:ss'
export const dateFormatTimeShort = 'HH:mm'
