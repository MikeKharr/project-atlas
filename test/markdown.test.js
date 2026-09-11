import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig, validateConfig } from '../lib/config.js'
import { atomicId, clip, firstParagraph, heading, makeGrammar, parseFrontmatter, replacementRefs, section } from '../lib/markdown.js'
import { EXAMPLE_CONFIG, FIXTURE } from './helpers.js'

const example = loadConfig(EXAMPLE_CONFIG).config
const minimal = loadConfig(join(FIXTURE, 'atlas.config.json')).config
const { scanCitations, mapCitations } = makeGrammar(example)

// Выражение цитат исходного пакета на 1d882f4 — дословно. Грамматика,
// собранная из конфигурации примера, обязана совпасть с ним знак в знак:
// иначе рёбра `cites` и ссылки vault разойдутся с исходным проектом.
const CITE_1D882F4 = new RegExp(
  [
    '(?<fence>^```[\\s\\S]*?^```)',
    '(?<dbl>``(?:[^`]|`(?!`))*``)',
    '(?<link>\\[\\[[^\\]\\n]*\\]\\])',
    'ADR\\s+`(?<adr>[^`\\n]+)`',
    '`(?<path>(?:agent_docs/)?(?:adr|development-history|design|guides)/[A-Za-z0-9._-]+)`',
    '`(?<root>(?:agent_docs/)?(?:architecture|index|glossary|AGENTS)\\.md)`',
    '\\bI-(?<inv>\\d+)\\b',
    '`(?<word>[a-z][a-z-]*)`',
  ].join('|'),
  'gm',
)

test('грамматика примера — дословно выражение исходного пакета', () => {
  assert.equal(makeGrammar(example).source, CITE_1D882F4.source)
})

test('грамматика фикстуры: обе формы пути к ADR разрешаются, чужая коллекция — просто слово', () => {
  const g = makeGrammar(minimal)
  const found = g.scanCitations(
    'см. `docs/adr/2026-01-10-0900-a.md`, `adr/2026-01-10-0900-a.md`, `history/2026-01-16-1200`, `design/x.md` и `guides/y.md`',
  )
  assert.deepEqual(
    found.map((f) => `${f.kind}:${f.value}`),
    ['path:adr/2026-01-10-0900-a.md', 'path:adr/2026-01-10-0900-a.md', 'path:history/2026-01-16-1200'],
  )
})

test('грамматика фикстуры: корневой документ в обеих формах записи', () => {
  const found = makeGrammar(minimal).scanCitations('`README.md`, `docs/README.md`, `CHANGELOG.md`')
  assert.deepEqual(
    found.map((f) => f.value),
    ['README.md', 'docs/README.md'],
  )
})

test('без файла инвариантов `I-N` — не цитата', () => {
  const { config } = validateConfig(
    { format: 1, project: { name: 'P', repo: 'r' }, docs: { root: 'docs', adr: 'adr' } },
    { file: 'atlas.config.json' },
  )
  assert.deepEqual(makeGrammar(config).scanCitations('опора на I-4'), [])
  assert.equal(makeGrammar(minimal).scanCitations('опора на I-4')[0].value, 'I-4')
})

test('имена корневых документов экранируются в выражении', () => {
  const { config } = validateConfig(
    { format: 1, project: { name: 'P', repo: 'r' }, docs: { root: 'docs', adr: 'adr', rootDocs: ['a.b.md'] } },
    { file: 'atlas.config.json' },
  )
  const g = makeGrammar(config)
  assert.deepEqual(g.scanCitations('`a.b.md` и `aXb.md`').map((f) => f.value), ['a.b.md'])
})

test('фронтматтер роли читает модель, усилие и список скиллов', () => {
  const { data, body } = parseFrontmatter(
    '---\nname: backend\nmodel: opus\neffort: medium\nskills:\n  - a\n  - b\n---\n# Backend\n',
  )
  assert.deepEqual(data, { name: 'backend', model: 'opus', effort: 'medium', skills: ['a', 'b'] })
  assert.equal(heading(body), 'Backend')
})

test('раздел берётся до следующего заголовка того же уровня', () => {
  const text = '# T\n\n## Статус\n\nПринято\n\n## Контекст\n\nПервый абзац.\nЕго продолжение.\n\nВторой.\n'
  assert.equal(section(text, 'Статус'), 'Принято')
  assert.equal(firstParagraph(section(text, 'Контекст')), 'Первый абзац. Его продолжение.')
})

test('выдержка обрезается по границе слова', () => {
  assert.equal(clip('раз два три', 8), 'раз два…')
  assert.equal(clip('коротко', 80), 'коротко')
})

test('цитата ADR разбирается и в форме id, и в форме имени файла', () => {
  const found = scanCitations('ADR `2026-09-07-1525` и ADR `2026-09-08-0205-skill-install-security-gate.md`')
  const adr = found.filter((f) => f.kind === 'adr').map((f) => f.value)
  assert.deepEqual(adr, ['2026-09-07-1525', '2026-09-08-0205'])
})

test('заглушки шаблонов цитатами не считаются', () => {
  const found = scanCitations('шаблон `agent_docs/adr/YYYY-MM-DD-HHMM-title.md`, ADR `YYYY-MM-DD-HHMM`, `guides/имя.md`')
  assert.deepEqual(found.filter((f) => f.kind === 'adr' || f.kind === 'path'), [])
})

test('пути к документам нормализуются без префикса корня документов', () => {
  const found = scanCitations('см. `agent_docs/guides/dod.md` и `development-history/2026-09-08-1245`')
  assert.deepEqual(
    found.filter((f) => f.kind === 'path').map((f) => f.value),
    ['guides/dod.md', 'development-history/2026-09-08-1245'],
  )
})

test('корневые документы читаются в обеих формах, прочие голые пути — нет', () => {
  const found = scanCitations('см. `agent_docs/glossary.md`, `glossary.md`, `AGENTS.md`, `agent_docs/AGENTS.md` и `README.md`')
  // Префикс сохраняется как написан: `agent_docs/AGENTS.md` — другой файл,
  // и разрешаться он обязан отдельно (и не разрешиться).
  assert.deepEqual(
    found.filter((f) => f.kind === 'path').map((f) => f.value),
    ['agent_docs/glossary.md', 'glossary.md', 'AGENTS.md', 'agent_docs/AGENTS.md'],
  )
})

test('образец не цитата: блок кода и двойные кавычки гейт не проверяет', () => {
  const fenced = ['```sh', 'см. ADR `2026-01-01-0000` и I-4', '```'].join('\n')
  assert.deepEqual(scanCitations(fenced), [], 'содержимое блока кода — образец, а не ссылка')

  const doubled = 'форма записи: `` ADR `2026-01-01-0000` `` и `` `compliance` ``'
  assert.deepEqual(scanCitations(doubled), [], 'двойные кавычки показывают цитату буквально')

  // Та же цитата, написанная обычным образом, видна — иначе сужение
  // означало бы дыру в гейте, а не отказ разбирать образцы.
  const plain = scanCitations('см. ADR `2026-01-01-0000` и I-4 у `compliance`')
  assert.deepEqual(
    plain.map((f) => `${f.kind}:${f.value}`),
    ['adr:2026-01-01-0000', 'invariant:I-4', 'word:compliance'],
  )
})

test('замена в копии не трогает образцы и не входит в готовую ссылку', () => {
  const map = (t) => mapCitations(t, (kind, value) => (kind === 'invariant' ? `[[invariants/${value}]]` : null))
  assert.equal(map('```\nI-4\n```'), '```\nI-4\n```')
  assert.equal(map('`` I-4 ``'), '`` I-4 ``')
  assert.equal(map('[[invariants/I-4]]'), '[[invariants/I-4]]')
  assert.equal(map('опора на I-4'), 'опора на [[invariants/I-4]]')
})

test('номер строки в находке — настоящий', () => {
  const found = scanCitations('строка один\n\nADR `2026-09-07-1525`\n')
  assert.equal(found.find((f) => f.kind === 'adr').line, 3)
})

test('цитата, перенесённая на другую строку, всё равно видна', () => {
  // Документы переносятся по ~80 символам: «… ADR ⏎ `id` …» — обычная форма.
  const found = scanCitations('Решение принято в ADR\n`2026-09-07-1525`, и это важно.\n')
  assert.deepEqual(
    found.filter((f) => f.kind === 'adr'),
    [{ kind: 'adr', value: '2026-09-07-1525', line: 1 }],
  )
})

test('находки идут в порядке появления в тексте', () => {
  const found = scanCitations('I-4\nADR `2026-09-07-1525`\n`compliance`\n')
  assert.deepEqual(
    found.map((f) => f.line),
    [1, 2, 3],
  )
})

test('инвариант распознаётся, а часть слова — нет', () => {
  const found = scanCitations('инвариант I-4 и I-12; не AI-1 и не 2026-09-13')
  assert.deepEqual(
    found.filter((f) => f.kind === 'invariant').map((f) => f.value),
    ['I-4', 'I-12'],
  )
})

test('строки замены читаются только из раздела «Статус»', () => {
  const text =
    '# T\n\n## Статус\n\nПринято. Заменяет `docs/adr/2026-01-10-0900-plain-storage.md`\n\n' +
    '## Контекст\n\n| Потребность | Заменяет `2026-01-01-0000` |\n'
  assert.deepEqual(replacementRefs(text), { replaces: ['2026-01-10-0900'], replacedBy: [] })
})

test('«Заменено на» отличается от «Заменяет»', () => {
  const text = '# T\n\n## Статус\n\nЗаменено на `2026-01-15-1000-indexed-storage.md`\n'
  assert.deepEqual(replacementRefs(text), { replaces: [], replacedBy: ['2026-01-15-1000'] })
})

test('идентификатор атомарного документа вынимается из имени файла', () => {
  assert.equal(atomicId('2026-01-15-1000-indexed-storage.md'), '2026-01-15-1000')
  assert.equal(atomicId('corpus.md'), null)
})
