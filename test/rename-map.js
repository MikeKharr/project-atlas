#!/usr/bin/env node
// Карта переименования формата 1 → 2 (`day` → `unit`), одна реализация на два
// применения: модуль для теста совместимости (`test/compat.test.js`) и команда
// для ручной сверки в PR переезда ai-advent:
//
//   node test/rename-map.js <каталог эталона> <каталог нашей сборки>
//
// Двух реализаций карты быть не должно: разойдясь, они дали бы «равенство»,
// которого нет. Карта — docs/migration-plan.md, раздел «Rename map».
//
// Координаты (`x`, `y`, `z`) не отображаются: если они поедут, это не
// переименование, а сдвиг раскладки, и его надо чинить, а не нормализовать.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** `day/<key>` → `unit/<key>`. Ключ единицы не меняется: `day1` остаётся `day1`. */
const mapId = (id) => (typeof id === 'string' && id.startsWith('day/') ? `unit/${id.slice('day/'.length)}` : id)

/**
 * Граф под карту: тип и идентификатор узла, концы рёбер. `provenance`
 * выбрасывается — обе сборки берут его из одного checkout, и сравнивать там
 * нечего, а тест по ходу переписывает overlay эталона.
 */
export function normalizeGraph(text) {
  const graph = JSON.parse(text)
  for (const node of graph.nodes ?? []) {
    node.id = mapId(node.id)
    if (node.type === 'day') node.type = 'unit'
  }
  for (const edge of graph.edges ?? []) {
    edge.from = mapId(edge.from)
    edge.to = mapId(edge.to)
  }
  delete graph.provenance
  return `${JSON.stringify(graph, null, 2)}\n`
}

/** Блок происхождения целиком — время и коммит к формату отношения не имеют. */
const PROVENANCE = /^<!--\nИСТОЧНИК: [^\n]*\nКОММИТ: [^\n]*\nСИНХРОНИЗИРОВАНО: [^\n]*\nВНИМАНИЕ: [^\n]*\n-->\n/m

/**
 * Заметка vault под карту: ключ фронтматтера `day:` → `unit:`, теги
 * `type/day` → `type/unit` и `day/N` → `unit/N`, ссылки `[[days/…]]` →
 * `[[units/…]]` (каталог переименован, значит и ссылки на него), блок
 * происхождения снят.
 */
export function normalizeNote(text) {
  return text
    .replace(PROVENANCE, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^day: /, 'unit: ')
        .replace(/^type: "day"$/, 'type: "unit"')
        .replace(/type\/day\b/g, 'type/unit')
        .replace(/(?<![A-Za-z])day\/(\d+)/g, 'unit/$1')
        .replace(/\[\[days\//g, '[[units/'),
    )
    .join('\n')
}

/** Путь заметки эталона → путь у нас: переименован только каталог. */
export const mapNotePath = (rel) => (rel.startsWith('days/') ? `units/${rel.slice('days/'.length)}` : rel)

const read = (path) => readFileSync(path, 'utf8')

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((rel) => rel.split('\\').join('/'))
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .sort()

/** Первая различающаяся строка двух текстов — чтобы расхождение чинилось по адресу. */
function firstDiff(name, ours, theirs) {
  if (ours === theirs) return null
  const a = ours.split('\n')
  const b = theirs.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `${name}, строка ${i + 1}:\n  наш:    ${String(a[i]).slice(0, 300)}\n  эталон: ${String(b[i]).slice(0, 300)}`
    }
  }
  return `${name}: тексты различаются длиной (${ours.length} против ${theirs.length})`
}

/**
 * Сравнение выходов с точностью до карты: `graph.json` (обе стороны через
 * карту), `site/texts.json` (побайтно — единиц в нём нет) и `vault/` (список
 * файлов эталона с переименованным каталогом, каждая заметка через карту).
 * @param {string} refDir каталог сборки эталона (`atlas/dist`)
 * @param {string} ourDir каталог нашей сборки
 * @param {{skip?: string[]}} options пути, которым разрешено отличаться
 * @returns {string|null} первое различие или null
 */
export function compareOutputs(refDir, ourDir, { skip = [] } = {}) {
  const skipped = new Set(skip)

  if (!skipped.has('graph.json')) {
    const diff = firstDiff('graph.json', normalizeGraph(read(join(ourDir, 'graph.json'))), normalizeGraph(read(join(refDir, 'graph.json'))))
    if (diff) return diff
  }

  if (!skipped.has('site/texts.json')) {
    const diff = firstDiff('site/texts.json', read(join(ourDir, 'site/texts.json')), read(join(refDir, 'site/texts.json')))
    if (diff) return diff
  }

  const refNotes = filesUnder(join(refDir, 'vault'))
  const ourNotes = filesUnder(join(ourDir, 'vault'))
  // После переименования каталога порядок меняется: `days/` сортировался
  // раньше, `units/` — позже. Сравнивается набор, а не порядок обхода.
  const expected = refNotes
    .map(mapNotePath)
    .filter((rel) => !skipped.has(`vault/${rel}`))
    .sort()
  const actual = ourNotes.filter((rel) => !skipped.has(`vault/${rel}`))
  if (expected.join('\n') !== actual.join('\n')) {
    const missing = expected.filter((rel) => !actual.includes(rel))
    const extra = actual.filter((rel) => !expected.includes(rel))
    return `vault/: набор файлов не совпал\n  нет у нас: ${missing.join(', ') || '—'}\n  лишние у нас: ${extra.join(', ') || '—'}`
  }

  for (const rel of refNotes) {
    const ours = mapNotePath(rel)
    if (skipped.has(`vault/${ours}`)) continue
    const diff = firstDiff(`vault/${ours}`, normalizeNote(read(join(ourDir, 'vault', ours))), normalizeNote(read(join(refDir, 'vault', rel))))
    if (diff) return diff
  }

  return null
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [refDir, ourDir] = process.argv.slice(2)
  if (!refDir || !ourDir) {
    console.error('использование: node test/rename-map.js <каталог эталона> <каталог нашей сборки>')
    process.exit(2)
  }
  const diff = compareOutputs(refDir, ourDir)
  if (diff === null) {
    console.log('различий нет')
    process.exit(0)
  }
  console.error(diff)
  process.exit(1)
}
