import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { loadConfig } from '../lib/config.js'
import { buildGraph } from '../lib/extract.js'
import { readSources } from '../lib/sources.js'
import { copyFixture } from './helpers.js'

// Проверка ссылок падает закрыто: сломанная ссылка — красная проверка, а
// не тихо пропавшее ребро. Закрытый список находок — docs/input-spec.md, §11.

const fixture = copyFixture()
after(() => fixture.cleanup())

const graphOf = () => {
  const config = loadConfig(join(fixture.root, 'atlas.config.json')).config
  return buildGraph(readSources(fixture.root, config), config)
}
const findings = () => graphOf().findings

/**
 * Ломает вход, считает находки и возвращает файл на место в любом случае:
 * упавший assert не должен ронять каскадом остальные тесты файла.
 */
function broken(rel, change) {
  const file = join(fixture.root, rel)
  const saved = existsSync(file) ? readFileSync(file, 'utf8') : null
  try {
    writeFileSync(file, change(saved ?? ''))
    return findings()
  } finally {
    if (saved === null) rmSync(file, { force: true })
    else writeFileSync(file, saved)
  }
}

const appended = (rel, tail) => broken(rel, (t) => t + tail)
const overlay = (change) =>
  broken(OVERLAY, (t) => {
    const o = JSON.parse(t)
    change(o)
    return JSON.stringify(o, null, 2)
  })
const configured = (change) =>
  broken('atlas.config.json', (t) => {
    const c = JSON.parse(t)
    change(c)
    return JSON.stringify(c, null, 2)
  })

const HISTORY = 'docs/history/2026-01-16-1200-index-rollout.md'
const ADR = 'docs/adr/2026-01-15-1000-indexed-storage.md'
const OVERLAY = 'atlas.overlay.json'

test('копия фикстуры без правок чиста', () => {
  assert.deepEqual(findings(), [])
})

test('цитата ADR без файла — находка с именем файла и строкой', () => {
  const found = appended(HISTORY, '\nСм. ADR `2026-01-01-0000`.\n')
  assert.equal(found.length, 1)
  assert.equal(found[0].file, HISTORY)
  assert.ok(found[0].line > 1)
  assert.match(found[0].message, /2026-01-01-0000.*docs\/adr\//)
})

test('битая цитата внутри блока кода находкой не становится', () => {
  const fenced = ['', '```sh', '# пример: ADR `2026-01-01-0000`', '```', ''].join('\n')
  assert.deepEqual(appended(HISTORY, fenced), [], 'образец в блоке кода гейт не проверяет')
  // Та же строка без блока — находка: сужение касается формы, не смысла.
  assert.equal(appended(HISTORY, '\nпример: ADR `2026-01-01-0000`\n').length, 1)
})

test('путь к записи истории без файла — находка, в обеих формах записи', () => {
  for (const cite of ['`history/2026-01-01-0000-nothing.md`', '`docs/history/2026-01-01-0000-nothing.md`']) {
    const found = appended(HISTORY, `\nСм. ${cite}.\n`)
    assert.equal(found.length, 1, cite)
    assert.match(found[0].message, /не разрешается/)
  }
})

test('ссылка на корневой документ проверяется гейтом', () => {
  assert.deepEqual(appended(HISTORY, '\nОписание — `README.md`.\n'), [])

  // Переименование корневого документа не проходит мимо: цитаты на него
  // становятся находками.
  const readme = join(fixture.root, 'README.md')
  const saved = readFileSync(readme, 'utf8')
  const history = join(fixture.root, HISTORY)
  const savedHistory = readFileSync(history, 'utf8')
  try {
    appendFileSync(history, '\nОписание — `README.md`.\n')
    rmSync(readme)
    const found = findings()
    assert.ok(found.some((f) => f.file === HISTORY && /README\.md/.test(f.message) && /не разрешается/.test(f.message)), JSON.stringify(found))
    assert.ok(found.some((f) => f.file === 'README.md' && /не читается/.test(f.message)), 'названный вход пропал')
  } finally {
    writeFileSync(readme, saved)
    writeFileSync(history, savedHistory)
  }
})

test('корневой документ по неверному пути — находка, а не тихое совпадение', () => {
  // `README.md` лежит в корне; `docs/README.md` — несуществующий файл.
  const found = appended(HISTORY, '\nОписание — `docs/README.md`.\n')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /docs\/README\.md/)
})

test('инвариант, которого нет в файле, — находка с источником и диапазоном', () => {
  const found = appended(HISTORY, '\nПо правилу I-999 это запрещено.\n')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /I-999/)
  assert.match(found[0].message, /docs\/invariants\.md \(там I-1…I-2\)/)
})

test('добавленный в файл инвариант становится разрешённым, а не находкой', () => {
  const file = join(fixture.root, 'docs/invariants.md')
  const saved = readFileSync(file, 'utf8')
  const history = join(fixture.root, HISTORY)
  const savedHistory = readFileSync(history, 'utf8')
  try {
    writeFileSync(file, `${saved}- **I-999.** Проверочное правило.\n`)
    appendFileSync(history, '\nПо правилу I-999 это запрещено.\n')
    const graph = graphOf()
    assert.deepEqual(graph.findings, [])
    assert.ok(graph.edges.some((e) => e.kind === 'relies' && e.to === 'invariant/I-999'))
  } finally {
    writeFileSync(file, saved)
    writeFileSync(history, savedHistory)
  }
})

test('роль в overlay, которой нет среди ролей, — находка со строкой overlay', () => {
  const found = broken(OVERLAY, (t) => t.replace('"gates": ["reviewer"]', '"gates": ["reveiwer"]'))
  assert.equal(found.length, 1)
  assert.equal(found[0].file, OVERLAY)
  assert.ok(found[0].line > 1)
  assert.match(found[0].message, /которой нет в agents\//)
})

test('класс фазы, которого нет в overlay, — находка', () => {
  const found = broken(OVERLAY, (t) => t.replace('"classes": ["A"]', '"classes": ["Z"]'))
  assert.equal(found.length, 1)
  assert.match(found[0].message, /класс Z, которого нет в overlay/)
})

test('calls от сервиса, когда compose не задан, — находка', () => {
  const found = overlay((o) => {
    o.externals = [{ id: 'api', title: 'API', kind: 'llm', note: 'x' }]
    o.calls = [{ from: 'app1', to: 'api' }]
  })
  assert.ok(found.some((f) => f.file === OVERLAY && /`app1`, которого нет в конфигурации: deploy\.compose не задан/.test(f.message)), JSON.stringify(found))
})

test('внешний узел без единого ребра — находка', () => {
  const found = overlay((o) => {
    o.externals = [{ id: 'lonely', title: 'Одинокий', kind: 'network', note: 'x' }]
  })
  assert.equal(found.length, 1)
  assert.match(found[0].message, /`lonely` не связан/)
})

test('publishes между неизвестными внешними — находка', () => {
  const found = overlay((o) => {
    o.publishes = [{ from: 'ci', to: 'registry' }]
  })
  assert.equal(found.length, 1)
  assert.match(found[0].message, /publishes/)
})

test('about: день без units и неизвестный документ — находки', () => {
  const day = overlay((o) => {
    o.about = { '2026-01-16-1200': { days: ['app9'], why: 'x' } }
  })
  assert.equal(day.length, 1)
  assert.match(day[0].message, /`app9`, которого нет в конфигурации: units не задан/)
  const doc = overlay((o) => {
    o.about = { '2099-01-01-0000': { days: [], why: 'x' } }
  })
  assert.equal(doc.length, 1)
  assert.match(doc[0].message, /документ `2099-01-01-0000`, которого нет/)
})

test('compose за подмножеством парсера — находка, а не пустые зависимости', () => {
  const dir = join(fixture.root, 'deploy')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'compose.yml'), 'services:\n  a:\n    image: x\n    depends_on:\n      b:\n        condition: service_healthy\n')
  try {
    const found = configured((c) => {
      c.deploy = { compose: 'deploy/compose.yml' }
    })
    assert.ok(found.length > 0)
    assert.equal(found[0].file, 'deploy/compose.yml')
    assert.match(found[0].message, /подмножеств/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('битый JSON входа — находка, а не стек', () => {
  const found = broken(OVERLAY, () => '{ это не json')
  assert.ok(found.some((f) => f.file === OVERLAY && /JSON/.test(f.message)))
})

test('пропавший вход — находка, а не стек', () => {
  const file = join(fixture.root, 'docs/invariants.md')
  const saved = readFileSync(file, 'utf8')
  try {
    rmSync(file)
    const found = findings()
    assert.ok(found.some((f) => f.file === 'docs/invariants.md' && /не читается/.test(f.message)))
  } finally {
    writeFileSync(file, saved)
  }
})

test('два входа с одним идентификатором узла — находка, а не тихо удвоенный узел', () => {
  // `README.md` даёт узел `guide/readme`; одноимённый гайд столкнётся с ним.
  const dir = join(fixture.root, 'docs/guides')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'readme.md'), '# Двойник\n\nТекст.\n')
  const configFile = join(fixture.root, 'atlas.config.json')
  const saved = readFileSync(configFile, 'utf8')
  try {
    const c = JSON.parse(saved)
    c.docs.guides = 'guides'
    writeFileSync(configFile, JSON.stringify(c))
    const graph = graphOf()
    assert.ok(graph.findings.some((f) => /строится дважды/.test(f.message)))
    assert.equal(graph.nodes.filter((n) => n.id === 'guide/readme').length, 1)
  } finally {
    writeFileSync(configFile, saved)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('строка замены на несуществующий ADR — находка', () => {
  const found = broken(ADR, (t) => t.replace('Заменяет `2026-01-10-0900`', 'Заменяет `2025-12-31-2359`'))
  assert.ok(found.some((f) => f.file === ADR && /«Заменяет» указан ADR `2025-12-31-2359`/.test(f.message)), JSON.stringify(found))
})

test('атомарный документ без идентификатора в имени — находка', () => {
  const found = appended('docs/adr/notes.md', '# Черновик\n')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /без идентификатора YYYY-MM-DD-HHMM/)
})

test('роль предзагружает неизвестный скилл — находка', () => {
  const found = broken('agents/reviewer.md', (t) => t.replace('effort: high\n', 'effort: high\nskills:\n  - missing\n'))
  assert.equal(found.length, 1)
  assert.match(found[0].message, /скилл `missing`, которого нет в конфигурации: agents\.skills не задан/)
})

test('после отката правок копия снова чиста', () => {
  assert.deepEqual(findings(), [])
})
