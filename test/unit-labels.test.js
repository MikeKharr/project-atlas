import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RELATION, TYPE_MANY, TYPE_NAME, TYPE_PLURAL, relation } from '../web/app.js'

/**
 * Формат 2 переименовал тип узла `day` в `unit`, и подписи интерфейса должны
 * звать его так же. Страж устроен как словарный (`test/vocab.test.js`): берёт
 * не список забытых строк, а **данные, которые рисует интерфейс** — таблицы
 * подписей целиком, — и проверяет их пословно.
 *
 * Область — ровно эти таблицы. Слово «день» в коде отрисовки остаётся: «Цикл
 * дня» — имя процесса `/day-cycle`, другой референт, и под страж не попадает
 * просто потому, что не является подписью типа узла.
 */

const FORMS = new Set(['день', 'дня', 'дню', 'днём', 'днем', 'дне', 'дни', 'дней', 'дням', 'днями', 'днях'])

/** Пословно: «дн» внутри «последний» или «одним» — не слово «день». */
const daySense = (text) => (text.match(/[А-Яа-яЁё]+/g) ?? []).filter((w) => FORMS.has(w.toLowerCase()))

const LABELS = [
  ['TYPE_NAME', Object.entries(TYPE_NAME)],
  ['TYPE_PLURAL', Object.entries(TYPE_PLURAL)],
  ['TYPE_MANY', Object.entries(TYPE_MANY)],
  ['RELATION', Object.entries(RELATION).flatMap(([k, v]) => v.map((s, i) => [`${k}[${i}]`, s]))],
]

test('матчер ловит слово, а не подстроку', () => {
  assert.deepEqual(daySense('про день'), ['день'])
  assert.deepEqual(daySense('документы дня'), ['дня'])
  assert.deepEqual(daySense('последний одним днями'), ['днями'])
  assert.deepEqual(daySense('про приложение'), [])
  assert.deepEqual(daySense('последний одним'), [])
})

test('в подписях интерфейса нет типа узла «день»', () => {
  for (const [table, entries] of LABELS) {
    for (const [key, value] of entries) {
      assert.deepEqual(daySense(value), [], `${table}.${key}: «${value}» — тип узла зовётся приложением`)
    }
  }
})

test('подпись ребра `about` названа единицей формата 2', () => {
  assert.equal(relation('about', true), 'про приложение')
  assert.equal(relation('about', false), 'документы приложения')
})
