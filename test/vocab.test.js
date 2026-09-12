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
 * Слова соглашений берутся из значений словаря `ru`, а не списком в тесте:
 * страж обновляется вместе со словарём. Синтаксис выражений снимается —
 * остаются кириллические слова и сами значения целиком.
 */
const NEEDLES = [...new Set([...VALUES(ru), ...VALUES(ru).flatMap((v) => v.match(/[А-Яа-яЁё]+/g) ?? [])])]
  .filter((s) => /[А-Яа-яЁё]/.test(s))
  .sort()

/**
 * Ищется не слово в тексте, а **форма сопоставления входа**: литерал, который
 * целиком есть слово словаря — с обёрткой выражения или без (`'Контекст'`,
 * `'^Принято'`, `/вето/i`, `/Заменено\s+на/`). Русская речь сообщений и
 * фиксированных текстов заметок такой формы не имеет: `«не читается никогда»`
 * и `«Правки вносить в репозиторий»` — это вывод, и он остаётся русским при
 * любом словаре (§8). Поэтому список исключений не нужен: страж ловит ровно
 * то, ради чего заведён, и молчит о прозе.
 */
const matcherLiterals = (source) =>
  (source.match(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|\/(?:[^/\n\\]|\\.)+\/[gimsuy]*/g) ?? [])
    .map((literal) => literal.replace(/^['"`]|['"`]$|^\/|\/[gimsuy]*$/g, ''))
    .map((body) => body.replace(/^\^|\$$|^\\b|\\b$|^\(\?:|\)$/g, ''))
    .filter((body) => NEEDLES.some((needle) => needle.toLowerCase() === body.toLowerCase()))

test('страж собран из словаря: слова взяты из значений `ru`, а не списком', () => {
  for (const word of ['Статус', 'Контекст', 'Задача', 'Владеет', 'Никогда', 'Заменяет', 'Принято', 'вето', 'правки', 'переделать']) {
    assert.ok(NEEDLES.includes(word), `${word} не выведено из словаря`)
  }
  assert.ok(NEEDLES.includes(ru.replacedBy), 'значение целиком тоже ищется')
})

test('страж ловит возвращённый литерал сопоставления и молчит о прозе', () => {
  // Положительный контроль: так выглядит возврат литерала в модуль.
  assert.deepEqual(matcherLiterals("const s = section(text, 'Контекст')"), ['Контекст'])
  assert.deepEqual(matcherLiterals('labeledParagraph(body, "Владеет")'), ['Владеет'])
  assert.deepEqual(matcherLiterals("new RegExp('^Принято', 'i')"), ['Принято'])
  assert.deepEqual(matcherLiterals('/вето/i.test(line)'), ['вето'])
  assert.deepEqual(matcherLiterals('const MARKS = [/Заменено\\s+на/]'), ['Заменено\\s+на'])
  // Отрицательный контроль: слово внутри фразы — речь, а не сопоставление.
  assert.deepEqual(matcherLiterals("note(rel, 1, 'такое не читается никогда')"), [])
  assert.deepEqual(matcherLiterals('`- Владеет: ${node.owns}`'), [])
  assert.deepEqual(matcherLiterals("'ВНИМАНИЕ: копия только для чтения. Правки вносить в репозиторий.'"), [])
})

/**
 * Разрешённые совпадения: заглушки фактов в заметках vault — `Образ: нет`,
 * `Файлы окружения: нет`, `Тома: нет`. Слово совпадает со значением словаря
 * (первое отрицание правила следов), но это **вывод**, а не сопоставление
 * входа: тексты заметок остаются русскими при любом словаре (§8) и входят в
 * сверку байт в байт формата 1. Список короткий и именной — новое совпадение
 * где угодно ещё красит тест.
 */
const ALLOWED = [{ file: 'lib/vault.js', literal: 'нет', count: 3 }]

test('ни один модуль не сопоставляет вход русским литералом', () => {
  const hits = []
  for (const path of modules(join(PKG, 'lib'))) {
    if (path === join(PKG, 'lib/vocab/ru.js')) continue
    const rel = path.slice(PKG.length)
    for (const [i, text] of readFileSync(path, 'utf8').split('\n').entries()) {
      for (const literal of matcherLiterals(text)) {
        if (ALLOWED.some((a) => a.file === rel && a.literal === literal)) continue
        hits.push(`${rel}:${i + 1}: ${literal}`)
      }
    }
  }
  assert.deepEqual(hits, [], 'слово соглашения вернулось в модуль литералом')
})

test('разрешённые совпадения — ровно те, что перечислены, и столько же', () => {
  // Если заглушка переедет или исчезнет, список исключений устареет заметно,
  // а не станет тихо разрешать лишнее.
  for (const { file, literal, count } of ALLOWED) {
    const found = readFileSync(join(PKG, file), 'utf8')
      .split('\n')
      .flatMap((text) => matcherLiterals(text))
      .filter((found) => found === literal)
    assert.equal(found.length, count, `${file}: ${literal}`)
  }
})

test('подписи фактов роли в заметке — вывод: по одной строке каждая, в vault.js', () => {
  // Они остаются русскими при любом словаре (§8) и входят в сверку байт в
  // байт формата 1, поэтому менять их нельзя. Страж их не ловит по форме —
  // здесь они названы явно, чтобы исключение было видно, а не подразумевалось.
  const source = readFileSync(join(PKG, 'lib/vault.js'), 'utf8').split('\n')
  for (const label of [/^\s*`- Владеет: \$\{node\.owns/, /^\s*`- Никогда: \$\{node\.never/]) {
    assert.equal(source.filter((text) => label.test(text)).length, 1, String(label))
  }
})
