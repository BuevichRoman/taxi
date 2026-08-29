/**
 * Правки b_options и c_options действием edit.
 *
 * Проверяем ровно то, что мок обязан повторять за боевым бэкендом: формат
 * списка правок, белые списки и то, что незнакомая форма запроса отбивается,
 * а не проглатывается молча.
 *
 * Правила перерывов здесь не проверяются: их считает приложение няни, и
 * тесты на них лежат там же — repos/taxi/src/tools/execution.test.ts.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    ApiError,
    applyOptionPatch,
    B_OPTIONS_VALID_KEYS,
    C_OPTIONS_VALID_KEYS,
} from './options.ts'

const patchC = (stored: Record<string, unknown>, patch: unknown) =>
    applyOptionPatch(stored, patch, C_OPTIONS_VALID_KEYS, 'c_options')

const execution = { schema_version: 1, mode: 'break', actual: { breaks: [] } }

describe('Формат списка правок', () => {
    it('объект вместо списка отбивается', () => {
        assert.throws(
            () => patchC({}, { c_execution: execution }),
            (e: ApiError) => e.message === 'c_options not array',
        )
    })

    it('элемент не список отбивается', () => {
        assert.throws(
            () => patchC({}, ['=']),
            (e: ApiError) => e.message === 'c_options element not array',
        )
    })

    it('неизвестный оператор отбивается', () => {
        assert.throws(
            () => patchC({}, [['*', ['c_execution'], 1]]),
            (e: ApiError) => e.message === 'wrong c_options element operator',
        )
    })

    it('путь не список отбивается', () => {
        assert.throws(
            () => patchC({}, [['=', 'c_execution', 1]]),
            (e: ApiError) => e.message === 'c_options element keys for assignment not array',
        )
    })
})

describe('Белый список', () => {
    it('разрешённый ключ записывается', () => {
        const next = patchC({}, [['=', ['c_execution'], execution]])

        assert.deepEqual(next['c_execution'], execution)
    })

    it('вложенные ключи под разрешённым не проверяются', () => {
        const next = patchC({}, [['=', ['c_execution', 'actual', 'mode'], 'work']])

        assert.equal(
            (next['c_execution'] as any).actual.mode,
            'work',
            'true у ключа означает «ниже можно всё»',
        )
    })

    it('ключ вне списка отбивается', () => {
        assert.throws(
            () => patchC({}, [['=', ['zzz_never_allowed'], 1]]),
            (e: ApiError) => e.message === 'wrong c_options element keys for assignment',
        )
    })

    it('у c_options свой список: b_execution туда не положить', () => {
        assert.throws(
            () => patchC({}, [['=', ['b_execution'], execution]]),
            (e: ApiError) => e.message === 'wrong c_options element keys for assignment',
        )
        assert.ok('b_execution' in B_OPTIONS_VALID_KEYS, 'а в b_options — можно')
    })
})

describe('Чего edit не умеет', () => {
    it('не создаёт поле с нуля: у незаполненного исполнителя правка отбивается', () => {
        assert.throws(
            () => applyOptionPatch(null, [['=', ['c_execution'], execution]],
                                   C_OPTIONS_VALID_KEYS, 'c_options'),
            (e: ApiError) =>
                e.message === 'c_options value for element keyc_execution for assignment not array',
            'заполняет поле set_performer при взятии заказа, не edit',
        )
    })

    it('не присваивает null: isset(null) это false', () => {
        assert.throws(
            () => patchC({ performers_price: 0 }, [['=', ['c_execution', 'mode'], null]]),
            (e: ApiError) => e.message === 'empty c_options element value for assignment',
        )
    })

    it('null внутри присваиваемого объекта проходит', () => {
        const next = patchC({ performers_price: 0 }, [
            ['=', ['c_execution'], { mode: null, actual: { ended: null } }],
        ])

        assert.equal((next['c_execution'] as any).mode, null,
                     'проверяется только значение верхнего уровня')
    })
})

describe('Наложение поверх сохранённого', () => {
    it('чужие ключи не затираются', () => {
        const next = patchC({ performers_price: 500 }, [['=', ['c_execution'], execution]])

        assert.equal(next['performers_price'], 500)
        assert.deepEqual(next['c_execution'], execution)
    })

    it('исходное значение не меняется', () => {
        const stored = { performers_price: 500 }
        patchC(stored, [['=', ['c_execution'], execution]])

        assert.deepEqual(stored, { performers_price: 500 }, 'правка возвращает новый объект')
    })

    it('оператор + добавляет в список', () => {
        const first = patchC({}, [['+', ['c_execution', 'actual', 'breaks'], { id: '1' }]])
        const second = patchC(first, [['+', ['c_execution', 'actual', 'breaks'], { id: '2' }]])
        const breaks = (second['c_execution'] as any).actual.breaks

        assert.equal(breaks.length, 2)
        assert.equal(breaks[1].id, '2')
    })

    it('оператор - убирает ключ', () => {
        const stored = patchC({}, [['=', ['c_execution'], execution]])
        const next = patchC(stored, [['-', ['c_execution']]])

        assert.equal(next['c_execution'], undefined)
    })

    it('в список можно спуститься по индексу', () => {
        const stored = patchC({}, [['+', ['c_execution', 'actual', 'breaks'], { id: '1', ended: null }]])
        const next = patchC(stored, [
            ['=', ['c_execution', 'actual', 'breaks', '0', 'ended'], '2026-08-05 11:30:00+03:00'],
        ])

        assert.equal(
            (next['c_execution'] as any).actual.breaks[0].ended,
            '2026-08-05 11:30:00+03:00',
            'в PHP is_array покрывает и списки, отбивать такой путь нельзя',
        )
    })

    it('спуск через не-контейнер отбивается', () => {
        const stored = patchC({}, [['=', ['c_execution', 'mode'], 'work']])

        assert.throws(
            () => patchC(stored, [['=', ['c_execution', 'mode', 'nested'], 1]]),
            (e: ApiError) => e.message === 'c_options value for element keymode for assignment not array',
        )
    })

    it('несколько правок применяются подряд', () => {
        const next = patchC({}, [
            ['=', ['c_execution', 'mode'], 'break'],
            ['+', ['c_execution', 'actual', 'breaks'], { id: '1' }],
        ])

        assert.equal((next['c_execution'] as any).mode, 'break')
        assert.equal((next['c_execution'] as any).actual.breaks.length, 1)
    })
})
