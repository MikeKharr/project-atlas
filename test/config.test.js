import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigError, denied, loadConfig, resolveInputs, unitNumber, validateConfig } from '../lib/config.js'
import { EXAMPLE_CONFIG, FIXTURE, TEMP } from './helpers.js'

// Правила конфигурации — docs/input-spec.md, §3.2–3.3, с правками ревью
// проектирования (грамматика путей, расширения по полям, `units.prefix`).
// Каждое правило — своя находка: опечатка в ключе не должна молча выключать вход.

/** Минимальная верная конфигурация: к ней тесты добавляют по одному нарушению. */
const base = () => ({
  format: 1,
  project: { name: 'P', repo: 'https://example.invalid/p' },
  docs: { root: 'docs', adr: 'adr' },
})

const check = (raw) => validateConfig(raw, { file: 'atlas.config.json', text: JSON.stringify(raw, null, 2) })
const messages = (raw) => check(raw).findings.map((f) => f.message)
const one = (raw, re) => {
  const found = messages(raw)
  assert.equal(found.length, 1, found.join('\n'))
  assert.match(found[0], re)
}

test('пример ai-advent-2026 загружается без находок', () => {
  const { config, findings } = loadConfig(EXAMPLE_CONFIG)
  assert.deepEqual(findings, [])
  assert.equal(config.project.name, 'AI Advent 2026')
  assert.equal(config.docs.adr, 'agent_docs/adr')
  assert.equal(config.units.re.source, '^day\\d+$', 'выражение дня собрано дословно, как было литералом')
})

test('конфигурация минимальной фикстуры загружается без находок', () => {
  const { config, findings } = loadConfig(join(FIXTURE, 'atlas.config.json'))
  assert.deepEqual(findings, [])
  assert.equal(config.docs.design, null)
  assert.equal(config.units, null)
  assert.deepEqual(resolveInputs(config), {
    read: ['docs/adr', 'docs/history', 'README.md', 'docs/invariants.md', 'agents', 'atlas.overlay.json'],
    listOnly: [],
  })
})

test('самая короткая конфигурация — формат, проект и docs с root и adr', () => {
  assert.deepEqual(check(base()).findings, [])
})

test('формат обязателен и равен 1', () => {
  const noFormat = base()
  delete noFormat.format
  one(noFormat, /`format` — обязательное поле/)
  one({ ...base(), format: 2 }, /`format` — поддерживается только формат 1/)
})

test('обязательные поля проекта и docs', () => {
  for (const [drop, re] of [
    [(c) => delete c.project, /`project` — обязательное/],
    [(c) => delete c.project.name, /`project.name` — обязательное/],
    [(c) => delete c.project.repo, /`project.repo` — обязательное/],
    [(c) => delete c.docs, /`docs` — обязательное/],
    [(c) => delete c.docs.root, /`docs.root` — обязательное/],
    [(c) => delete c.docs.adr, /`docs.adr` — обязательное/],
  ]) {
    const c = base()
    drop(c)
    one(c, re)
  }
})

test('неизвестный ключ — находка на любом уровне, с номером строки', () => {
  one({ ...base(), overlays: 'x.json' }, /`overlays` — неизвестный ключ/)
  const nested = base()
  nested.docs.histroy = 'history'
  const [found] = check(nested).findings
  assert.match(found.message, /`docs.histroy` — неизвестный ключ/)
  assert.ok(found.line > 1, 'находка указывает на строку ключа')
  one(
    { ...base(), deploy: { compose: 'c.yml', registry: { prefix: 'r/', external: 'e', extra: 1 } }, overlay: 'o.json' },
    /`deploy.registry.extra`/,
  )
})

test('убранные ревью поля — неизвестные ключи, а не тихо проигнорированные', () => {
  one({ ...base(), language: 'ru' }, /`language` — неизвестный ключ/)
  one({ ...base(), secrets: { mask: [] } }, /`secrets` — неизвестный ключ/)
  one({ ...base(), project: { name: 'P', repo: 'r', start: 'phase/01' } }, /`project.start` — неизвестный ключ/)
})

test('вид значения: строка, список, объект', () => {
  one({ ...base(), project: { name: 1, repo: 'r' } }, /`project.name` — ожидается непустая строка/)
  one({ ...base(), docs: { root: 'docs', adr: 'adr', rootDocs: 'README.md' } }, /`docs.rootDocs` — ожидается список/)
  one({ ...base(), agents: 'agents' }, /`agents` — ожидается объект/)
  one({ ...base(), deploy: { compose: 'c.yml', proxy: 'p', static: {} } }, /`deploy.static` — ожидается список/)
})

test('злонамеренный путь — находка: `..`, абсолютный, `.`, пустой сегмент, чужие символы', () => {
  for (const bad of ['/etc/passwd.json', '../x.json', 'a/../b.json', './a.json', 'a//b.json', 'a\\b.json', 'a b.json', 'a/.json/..']) {
    one({ ...base(), overlay: bad }, /`overlay` — путь от корня репозитория/)
  }
  one({ ...base(), docs: { root: '.', adr: 'adr' } }, /`docs.root` — путь от корня/)
  one({ ...base(), docs: { root: '..', adr: 'adr' } }, /`docs.root` — путь от корня/)
})

test('расширение файла — по полю', () => {
  one({ ...base(), docs: { root: 'docs', adr: 'adr', rootDocs: ['.npmrc'] } }, /`docs.rootDocs\[0\]` — ожидается файл `\.md`/)
  one({ ...base(), docs: { root: 'docs', adr: 'adr', invariants: 'rules.txt' } }, /`docs.invariants` — ожидается файл `\.md`/)
  one({ ...base(), overlay: 'overlay.yml' }, /`overlay` — ожидается файл `\.json`/)
  one({ ...base(), agents: { skills: 's', skillsLock: 'lock.txt' } }, /`agents.skillsLock` — ожидается файл `\.json`/)
  one({ ...base(), deploy: { compose: 'compose.json' } }, /`deploy.compose` — ожидается файл `\.yml` или `\.yaml`/)
  assert.deepEqual(messages({ ...base(), deploy: { compose: 'compose.yaml' } }), [])
  one(
    { ...base(), units: { dir: 'apps', prefix: 'app' }, deploy: { landing: 'site/index.md' } },
    /`deploy.landing` — ожидается файл `\.html`/,
  )
  one({ ...base(), deploy: { compose: 'c.yml', providers: { file: 'p.yml', service: 'r' } } }, /`deploy.providers.file` — ожидается файл `\.json`/)
})

test('имя коллекции — одно имя каталога', () => {
  one({ ...base(), docs: { root: 'docs', adr: 'decisions/adr' } }, /`docs.adr` — ожидается одно имя каталога/)
})

test('запретный путь — находка, даже если назван явно', () => {
  for (const bad of [
    '.env',
    '.env.local',
    'deploy/app.env',
    'x/.env',
    'temp/notes',
    'logs/app',
    'data/a',
    'router/data/ledger',
    'state.sqlite',
    'state.sqlite-journal',
    'build.log',
    'node_modules/x',
    '.git/config',
  ]) {
    one({ ...base(), agents: { roles: bad } }, /запретного списка/)
  }
})

test('запретный список не задевает обычных имён', () => {
  for (const ok of ['docs/metadata.md', 'environment.md', 'agent_docs/adr', 'site/index.html', 'dataset/x.md']) {
    assert.equal(denied(ok), false, ok)
  }
})

test('зависимости между полями — по находке на каждое незаданное поле', () => {
  one({ ...base(), deploy: { compose: 'c.yml', caddyfile: 'Caddyfile' } }, /`deploy.caddyfile` — требует `deploy.proxy`/)
  one({ ...base(), deploy: { proxy: 'p', caddyfile: 'Caddyfile' } }, /`deploy.caddyfile` — требует `deploy.compose`/)
  one({ ...base(), deploy: { landing: 'site/index.html' } }, /`deploy.landing` — требует `units`/)
  const site = [{ name: 's', dir: 's', file: 's/i.html' }]
  one({ ...base(), deploy: { proxy: 'p', static: site } }, /`deploy.static` — требует `deploy.compose`/)
  one({ ...base(), deploy: { compose: 'c.yml', static: site } }, /`deploy.static` — требует `deploy.proxy`/)
  one({ ...base(), deploy: { compose: 'c.yml', registry: { prefix: 'r/', external: 'e' } } }, /`deploy.registry` — требует `overlay`/)
  assert.equal(messages({ ...base(), deploy: { registry: { prefix: 'r/', external: 'e' } } }).length, 2, 'registry без compose и без overlay')
  one({ ...base(), deploy: { providers: { file: 'p.json', service: 'router' } } }, /`deploy.providers` — требует `deploy.compose`/)
  one({ ...base(), agents: { skillsLock: 'skills-lock.json' } }, /`agents.skillsLock` — требует `agents.skills`/)
})

test('имена коллекций различны между собой и с корневыми документами', () => {
  one({ ...base(), docs: { root: 'docs', adr: 'adr', history: 'adr' } }, /`docs.history` — имя `adr` уже занято `docs.adr`/)
  one({ ...base(), docs: { root: 'docs', adr: 'adr', guides: 'guides', rootDocs: ['guides.md'] } }, /совпадает с коллекцией `docs.guides`/)
  one({ ...base(), docs: { root: 'docs', adr: 'adr', rootDocs: ['README.md', 'docs/readme.md'] } }, /уже занято `README.md`/)
})

test('префикс единиц: буквы, `_` и `-`, без цифр', () => {
  const units = (prefix) => ({ ...base(), units: { dir: 'apps', prefix } })
  assert.deepEqual(messages(units('app-')), [])
  for (const bad of ['app1', '1app', 'a(b', '']) assert.ok(messages(units(bad)).length === 1, bad)
})

test('номер единицы — всё после префикса', () => {
  const { config } = check({ ...base(), units: { dir: 'apps', prefix: 'app-' } })
  assert.equal(unitNumber(config, 'app-12'), 12)
  assert.equal(config.units.re.test('app-12'), true)
  assert.equal(config.units.re.test('app-12x'), false)
})

test('нечитаемый файл и не-JSON — ConfigError, а не находка', () => {
  mkdirSync(TEMP, { recursive: true })
  const dir = mkdtempSync(join(TEMP, 'config-'))
  try {
    assert.throws(() => loadConfig(join(dir, 'нет.json')), ConfigError)
    writeFileSync(join(dir, 'broken.json'), '{ "format": 1,')
    assert.throws(() => loadConfig(join(dir, 'broken.json')), (e) => e instanceof ConfigError && /JSON/.test(e.message))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
