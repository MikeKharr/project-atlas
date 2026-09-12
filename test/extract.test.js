import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { loadConfig } from '../lib/config.js'
import { buildGraph } from '../lib/extract.js'
import { layout } from '../lib/layout.js'
import { readSources } from '../lib/sources.js'
import { FIXTURE, FIXTURE_EN, addDeploy, copyFixture, density, editConfig } from './helpers.js'

// Узлы и рёбра — docs/input-spec.md, §4. Числа живого проекта проверяет
// задача `compat` по test/golden/ai-advent-2026.txt; здесь — правила на синтетике:
// минимальная фикстура и деплой поверх её копии.

const load = (root) => loadConfig(join(root, 'atlas.config.json')).config

const config = load(FIXTURE)
const sources = readSources(FIXTURE, config)
const graph = buildGraph(sources, config)
const of = (g, type) => g.nodes.filter((n) => n.type === type)
const kind = (g, k) => g.edges.filter((e) => e.kind === k)
const line = (e) => `${e.kind} ${e.from} → ${e.to}`

const deployed = copyFixture()
after(() => deployed.cleanup())
addDeploy(deployed.root)
const dconfig = load(deployed.root)
const dsources = readSources(deployed.root, dconfig)
const dg = buildGraph(dsources, dconfig)
const node = (g, id) => g.nodes.find((n) => n.id === id)

// Английский близнец минимальной фикстуры: тот же граф на словаре `en`.
const enConfig = load(FIXTURE_EN)
const enGraph = buildGraph(readSources(FIXTURE_EN, enConfig), enConfig)

test('английская фикстура: находок нет, узлы и рёбра — ровно те же, что у русской', () => {
  assert.deepEqual(enGraph.findings, [])
  assert.deepEqual(
    enGraph.nodes.map((n) => n.id),
    graph.nodes.map((n) => n.id),
  )
  assert.deepEqual(enGraph.edges.map(line), graph.edges.map(line))
})

test('английская фикстура: статус, выдержка, факты роли и след читаются словарём', () => {
  const adr = node(enGraph, 'adr/2026-01-15-1000')
  assert.match(adr.status, /^Accepted/)
  assert.match(adr.excerpt, /^There are more notes now/, 'выдержка — раздел `Context`')
  assert.match(node(enGraph, 'history/2026-01-16-1200').excerpt, /^The index was built/, 'раздел `What was done`')

  const role = node(enGraph, 'role/reviewer')
  assert.equal(role.owns, 'checking changes before a merge, tests included.')
  assert.equal(role.never, 'checks code of its own writing.')

  const [trace, ...rest] = kind(enGraph, 'fired')
  assert.deepEqual(rest, [], 'строка с отрицанием следа не даёт')
  assert.equal(trace.excerpt.slice(...trace.marks.role), 'reviewer')
  assert.equal(trace.excerpt.slice(...trace.marks.sign), 'Changes requested')
})

// --- минимальная фикстура ---------------------------------------------------

test('минимальная фикстура: находок нет', () => {
  assert.deepEqual(graph.findings, [])
})

test('узлы — в порядке таблицы §4.1', () => {
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    [
      'adr/2026-01-10-0900',
      'adr/2026-01-15-1000',
      'history/2026-01-16-1200',
      'guide/readme',
      'invariant/I-1',
      'invariant/I-2',
      'role/reviewer',
      'tier/model-a-high',
      'class/A',
      'phase/01',
    ],
  )
})

test('рёбра — в порядке кода: цитаты внутри документа по порядку появления', () => {
  assert.deepEqual(graph.edges.map(line), [
    'tier role/reviewer → tier/model-a-high',
    'gates class/A → role/reviewer',
    'runs phase/01 → role/reviewer',
    'runs phase/01 → class/A',
    'relies adr/2026-01-10-0900 → invariant/I-2',
    'cites adr/2026-01-15-1000 → adr/2026-01-10-0900',
    'relies adr/2026-01-15-1000 → invariant/I-2',
    'mentions adr/2026-01-15-1000 → role/reviewer',
    'cites history/2026-01-16-1200 → adr/2026-01-15-1000',
    'cites history/2026-01-16-1200 → adr/2026-01-10-0900',
    'mentions history/2026-01-16-1200 → role/reviewer',
    'relies history/2026-01-16-1200 → invariant/I-1',
    'cites guide/readme → adr/2026-01-10-0900',
    'cites guide/readme → adr/2026-01-15-1000',
    'mentions guide/readme → role/reviewer',
    'relies guide/readme → invariant/I-1',
    'relies role/reviewer → invariant/I-1',
    'cites role/reviewer → adr/2026-01-15-1000',
    'replaces adr/2026-01-15-1000 → adr/2026-01-10-0900',
    'fired role/reviewer → history/2026-01-16-1200',
  ])
})

test('необязательные входы не заданы — ни узлов, ни находок', () => {
  for (const type of ['design', 'skill', 'day', 'service', 'volume', 'external']) assert.equal(of(graph, type).length, 0, type)
})

test('ярус: модель и усилие; префикс модели снимается только в начале', () => {
  assert.equal(node(graph, 'tier/model-a-high').title, 'model-a / high', 'без modelPrefix имя модели целиком')
  const fx = copyFixture()
  try {
    editConfig(fx.root, (c) => {
      c.agents.modelPrefix = 'model-'
    })
    const c = load(fx.root)
    assert.equal(node(buildGraph(readSources(fx.root, c), c), 'tier/model-a-high').title, 'a / high')
    editConfig(fx.root, (c) => {
      c.agents.modelPrefix = 'a'
    })
    const c2 = load(fx.root)
    assert.equal(node(buildGraph(readSources(fx.root, c2), c2), 'tier/model-a-high').title, 'model-a / high')
  } finally {
    fx.cleanup()
  }
})

test('у ADR есть статус, у документов — выдержка и путь к файлу', () => {
  const adr = node(graph, 'adr/2026-01-15-1000')
  assert.match(adr.status, /^Принято/)
  assert.equal(adr.file, 'docs/adr/2026-01-15-1000-indexed-storage.md')
  assert.match(adr.excerpt, /^Заметок стало больше/)
  assert.match(node(graph, 'history/2026-01-16-1200').excerpt, /^Индекс собран/, 'выдержка — раздел «Что сделано»')
  assert.match(node(graph, 'guide/readme').excerpt, /^Синтетический проект/, 'без разделов — тело после H1')
})

test('роль: владеет и никогда — абзацы целиком через перенос', () => {
  const role = node(graph, 'role/reviewer')
  assert.equal(role.owns, 'проверкой изменений перед мержем, включая тесты.')
  assert.equal(role.never, 'не проверяет собственный код.')
})

test('id ручного факта не по грамматике — находка, узла нет', () => {
  const overlay = {
    ...sources.overlay,
    classes: [{ id: '../x', title: 't', what: 'w', gates: [] }],
    phases: [{ n: '01', title: 't', roles: [], exit: 'e' }],
  }
  const g = buildGraph({ ...sources, overlay, overlayText: JSON.stringify(overlay, null, 2) }, config)
  assert.ok(g.findings.some((f) => /id класса `\.\.\/x`/.test(f.message)), JSON.stringify(g.findings))
  assert.ok(g.findings.some((f) => /номер фазы `01`/.test(f.message)), JSON.stringify(g.findings))
  assert.equal(g.nodes.some((n) => n.type === 'class' || n.type === 'phase'), false)
})

test('каждый узел несёт координаты в единичном квадрате', () => {
  for (const g of [graph, dg]) {
    for (const n of g.nodes) {
      for (const v of [n.x, n.y]) {
        assert.equal(typeof v, 'number', n.id)
        assert.ok(v >= 0 && v <= 1, `${n.id}: ${v}`)
        assert.ok((String(v).split('.')[1] ?? '').length <= 6, `${n.id}: ${v}`)
      }
    }
    assert.equal(new Set(g.nodes.map((n) => `${n.x},${n.y}`)).size, g.nodes.length)
  }
  // Заполненность, а не габаритная рамка; что считается ячейкой — `density`.
  const { busy, filled, median } = density(dg.nodes)
  assert.ok(filled >= 0.5, `в своей ячейке сетки 20×20 ${busy} узлов из ${dg.nodes.length}`)
  assert.ok(median >= 0.02, `медиана расстояния до ближайшего соседа ${median.toFixed(4)}`)
})

test('каждый узел несёт z в 0…1, а x и y — ровно те, что даёт плоская раскладка', () => {
  const plane = layout(graph.nodes, graph.edges)
  const linked = new Set(graph.edges.flatMap((e) => (e.from === e.to ? [] : [e.from, e.to])))
  for (const n of graph.nodes) {
    assert.deepEqual({ x: n.x, y: n.y }, plane.get(n.id), n.id)
    assert.ok(n.z >= 0 && n.z <= 1, `${n.id}: ${n.z}`)
    assert.ok((String(n.z).split('.')[1] ?? '').length <= 6, `${n.id}: ${n.z}`)
    if (!linked.has(n.id)) assert.equal(n.z, 0.5, `${n.id} без рёбер вне плоскости 0.5`)
  }
  // z стоит перед x, y закрывает узел: строка y не получает запятую.
  for (const n of graph.nodes) assert.deepEqual(Object.keys(n).slice(-3), ['z', 'x', 'y'], n.id)
})

test('след: строка таблицы — единица, marks — роль и признак, «вето нет» следа не даёт', () => {
  const [trace, ...rest] = kind(graph, 'fired')
  assert.deepEqual(rest, [])
  const record = sources.history[0].text.split('\n')
  assert.match(record[trace.line - 1], /^\| reviewer \| \*\*Правки:\*\*/)
  assert.equal(trace.excerpt.slice(...trace.marks.role), 'reviewer')
  assert.equal(trace.excerpt.slice(...trace.marks.sign), 'Правки')
  assert.equal(trace.excerpt.endsWith('…'), false)
  const denial = record.findIndex((l) => /вето нет/.test(l)) + 1
  assert.ok(denial > 0)
  assert.equal(kind(graph, 'fired').some((e) => e.line === denial), false)
})

// --- синтетический деплой ---------------------------------------------------

test('деплой: находок нет', () => {
  assert.deepEqual(dg.findings, [])
})

test('деплой: единицы по номеру, сервисы compose, статика, тома, внешние — по порядку', () => {
  assert.deepEqual(
    dg.nodes.map((n) => n.id).filter((id) => /^(unit|service|volume|external)\//.test(id)),
    [
      'unit/app1',
      'unit/app2',
      'service/gateway',
      'service/web',
      'service/public',
      'volume/app1_data',
      'volume/gateway_data',
      'volume/web_data',
      'external/model-x',
      'external/registry',
      'external/ci',
      'external/model-api',
    ],
  )
})

test('единица: название и дата с лендинга, маршрут, каталог, образ, окружение', () => {
  assert.deepEqual(
    { ...node(dg, 'unit/app1'), x: 0, y: 0, z: 0 },
    {
      id: 'unit/app1',
      type: 'unit',
      key: 'app1',
      title: 'Первое приложение',
      date: '01.02',
      dir: 'apps/app1',
      route: '/app1/',
      image: 'registry.invalid/team/app1:latest',
      envFiles: ['./app1.env'],
      z: 0,
      x: 0,
      y: 0,
    },
  )
  assert.deepEqual(
    { ...node(dg, 'service/public'), x: 0, y: 0, z: 0 },
    {
      id: 'service/public',
      type: 'service',
      key: 'public',
      title: 'public',
      source: 'public/',
      file: 'public/index.html',
      note: 'Статика, которую web отдаёт из bind-монтирования ../public.',
      z: 0,
      x: 0,
      y: 0,
    },
  )
})

test('depends и mounts — внутри каждого сервиса в порядке compose', () => {
  assert.deepEqual(dg.edges.filter((e) => e.kind === 'depends' || e.kind === 'mounts').map(line), [
    'depends unit/app1 → service/gateway',
    'mounts unit/app1 → volume/app1_data',
    'depends unit/app2 → service/gateway',
    'mounts service/gateway → volume/gateway_data',
    'depends service/web → unit/app1',
    'depends service/web → unit/app2',
    'mounts service/web → volume/web_data',
  ])
})

test('маршруты прокси — действующие handle_path; комментарий маршрутом не считается', () => {
  assert.deepEqual(kind(dg, 'routes').map(line), [
    'routes service/web → unit/app1',
    'routes service/web → unit/app2',
    'routes service/web → service/gateway',
  ])
  assert.equal(node(dg, 'unit/app2').route, '/app2/')
})

test('префикс handle_path не протекает в следующий блок `handle /x/*`', () => {
  const caddyText = dsources.caddyText.replace('handle_path /app2/* {', 'handle /app2/* {')
  assert.notEqual(caddyText, dsources.caddyText)
  const g = buildGraph({ ...dsources, caddyText }, dconfig)
  assert.equal(node(g, 'unit/app2').route, null, 'app2 получил префикс чужого блока')
  assert.equal(node(g, 'unit/app1').route, '/app1/')
  assert.ok(g.edges.some((e) => e.kind === 'routes' && e.to === 'unit/app2'), 'сервис за reverse_proxy — всё равно маршрут')
})

test('префикс handle_path не протекает в следующий блок `handle {`', () => {
  const caddyText = dsources.caddyText.replace('handle_path /app1/* {', 'handle {')
  const g = buildGraph({ ...dsources, caddyText }, dconfig)
  assert.equal(node(g, 'unit/app1').route, null)
  assert.equal(node(g, 'unit/app2').route, '/app2/')
})

test('два блока на один сервис дают одно ребро routes', () => {
  const caddyText = dsources.caddyText.replace('\t# --- статика ---', '\thandle_path /gw2/* {\n\t\treverse_proxy gateway:9000\n\t}\n\n\t# --- статика ---')
  assert.notEqual(caddyText, dsources.caddyText)
  const g = buildGraph({ ...dsources, caddyText }, dconfig)
  assert.equal(g.edges.filter((e) => e.kind === 'routes' && e.to === 'service/gateway').length, 1)
})

test('прокси отдаёт статику, только если монтирует её каталог', () => {
  assert.deepEqual(kind(dg, 'serves').map(line), ['serves service/web → service/public'])
  const composeText = dsources.composeText.replace('../public:/srv:ro', '../other:/srv:ro')
  assert.deepEqual(kind(buildGraph({ ...dsources, composeText }, dconfig), 'serves'), [])
})

test('реестр образов: image от сервисов с префиксом, publishes из overlay', () => {
  assert.deepEqual(kind(dg, 'image').map(line), [
    'image unit/app1 → external/registry',
    'image unit/app2 → external/registry',
    'image service/gateway → external/registry',
  ])
  assert.deepEqual(kind(dg, 'publishes').map(line), ['publishes external/ci → external/registry'])
})

test('провайдеры: calls от сервиса провайдеров, адрес провайдера не публикуется', () => {
  assert.ok(kind(dg, 'calls').some((e) => e.from === 'service/gateway' && e.to === 'external/model-x'))
  const json = JSON.stringify(dg)
  assert.equal(json.includes('baseUrl'), false)
  assert.equal(json.includes('gateway.invalid'), false)
  assert.equal(node(dg, 'external/model-x').title, 'model-x (x-small)')
})

test('calls из overlay: от единицы к внешнему', () => {
  assert.ok(kind(dg, 'calls').some((e) => e.from === 'unit/app1' && e.to === 'external/model-api'))
})

test('about: имя единицы целым словом в имени файла; overlay перебивает', () => {
  assert.deepEqual(kind(dg, 'about').map(line), ['about history/2026-01-20-0900 → unit/app2'])
  const overlay = { ...dsources.overlay, about: { '2026-01-20-0900': { units: ['app1'], why: 'проверка' } } }
  const g = buildGraph({ ...dsources, overlay, overlayText: JSON.stringify(overlay, null, 2) }, dconfig)
  assert.deepEqual(kind(g, 'about').map(line), ['about history/2026-01-20-0900 → unit/app1'])
})

test('about с ключом `days` формата 1 — находка о переименовании, привязки нет', () => {
  const overlay = {
    ...dsources.overlay,
    about: {
      '2026-01-16-1200': { days: ['app1'], why: 'формат 1' },
      '2026-01-20-0900': { days: ['app2'], why: 'формат 1' },
    },
  }
  const overlayText = JSON.stringify(overlay, null, 2)
  const g = buildGraph({ ...dsources, overlay, overlayText }, dconfig)

  const renamed = g.findings.filter((f) => f.message === 'в about ключ `days` переименован в `units` (формат 2)')
  assert.equal(renamed.length, 2, JSON.stringify(g.findings))
  // Каждая находка — по адресу своей записи, а не первой попавшейся.
  assert.notEqual(renamed[0].line, renamed[1].line, 'обе находки показывают на одну строку')
  for (const finding of renamed) assert.match(overlayText.split('\n')[finding.line - 1], /"days"/)

  // Старый ключ не читается: привязка по имени файла тоже не подставляется.
  assert.deepEqual(kind(g, 'about'), [])
})

test('находки §11.7: прокси и сервис провайдеров — сервисы compose, внешний реестра — в overlay', () => {
  const with_ = (deploy) => buildGraph(dsources, { ...dconfig, deploy: { ...dconfig.deploy, ...deploy } }).findings.map((f) => f.message)
  assert.ok(with_({ proxy: 'nginx' }).some((m) => /`deploy.proxy`: сервиса `nginx` нет в deploy\/compose\.yml/.test(m)))
  assert.ok(
    with_({ providers: { file: 'gateway/providers.json', service: 'router' } }).some((m) =>
      /`deploy.providers.service`: сервиса `router` нет/.test(m),
    ),
  )
  assert.ok(
    with_({ registry: { prefix: 'registry.invalid/', external: 'hub' } }).some((m) =>
      /`deploy.registry.external`: внешнего сервиса `hub` нет среди externals/.test(m),
    ),
  )
})
