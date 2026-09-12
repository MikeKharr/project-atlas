import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import en from '../lib/vocab/en.js'
import ru from '../lib/vocab/ru.js'
import { PKG } from './helpers.js'

// Словарь — единственное место, где живут слова соглашений документов
// (docs/input-spec.md, §8). Всё остальное берёт его аргументом.

const VALUES = (v) => [
  v.letters,
  v.sections.status,
  ...v.sections.excerpt,
  ...Object.values(v.labels),
  v.replaces,
  v.replacedBy,
  ...Object.values(v.status),
  ...v.fired.marks,
  ...v.fired.negations,
  ...(v.placeholder === undefined ? [] : [v.placeholder]),
]

test('словари совпадают ключ в ключ, кроме необязательного `placeholder`', () => {
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(ru)
      .filter((k) => k !== 'placeholder')
      .sort(),
  )
  for (const group of ['sections', 'labels', 'status', 'fired']) {
    assert.deepEqual(Object.keys(en[group]).sort(), Object.keys(ru[group]).sort(), group)
  }
  assert.equal(en.sections.excerpt.length, ru.sections.excerpt.length, 'источников выдержки поровну')
})

test('`placeholder` у en не задан намеренно', () => {
  // Слово `name` дало бы в грамматике `\bname\b`, и цитата, в имени которой
  // это слово просто встречается, перестала бы быть цитатой (§8).
  assert.equal(en.placeholder, undefined)
  assert.equal(ru.placeholder, 'имя')
})

test('все значения словарей — разбираемые регулярные выражения', () => {
  for (const vocab of [ru, en]) {
    for (const value of VALUES(vocab)) {
      assert.equal(typeof value, 'string')
      assert.doesNotThrow(() => new RegExp(value), value)
    }
  }
})

/** Все `.js` каталога, рекурсивно. */
const modules = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? modules(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
  )

/**
 * Единственное разрешённое совпадение: подпись факта роли в заметке vault.
 * Это **вывод**, а не разбор входа, — §8 оставляет тексты заметок русскими
 * при любом словаре, и на этой строке держится байтовое равенство формата 1
 * (`vault/roles/*.md` исходного пакета). Всё прочее — слово соглашения,
 * забытое вне словаря.
 */
const ALLOWED = [{ file: 'lib/vault.js', line: /^\s*`- Владеет: \$\{node\.owns/ }]

test('русские слова соглашений — только в словаре ru и в фиксированном тексте заметок', () => {
  const words = /Статус|Владеет|Заменяет|вето/
  const hits = []
  for (const path of modules(join(PKG, 'lib'))) {
    if (path === join(PKG, 'lib/vocab/ru.js')) continue
    const rel = path.slice(PKG.length)
    for (const [i, text] of readFileSync(path, 'utf8').split('\n').entries()) {
      if (!words.test(text)) continue
      if (ALLOWED.some((a) => a.file === rel && a.line.test(text))) continue
      hits.push(`${rel}:${i + 1}: ${text.trim()}`)
    }
  }
  assert.deepEqual(hits, [], 'слово соглашения осталось вне словаря')
})

test('разрешённое совпадение — ровно одно и на месте', () => {
  // Если подпись переедет или исчезнет, список исключений обязан устареть
  // заметно, а не тихо разрешать лишнее.
  const lines = readFileSync(join(PKG, 'lib/vault.js'), 'utf8')
    .split('\n')
    .filter((text) => ALLOWED[0].line.test(text))
  assert.equal(lines.length, 1)
})
