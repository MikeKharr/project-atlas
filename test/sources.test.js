import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig, resolveInputs } from '../lib/config.js'
import { makeGuard, readSources } from '../lib/sources.js'
import { EXAMPLE_CONFIG, TEMP, copyFixture, editConfig } from './helpers.js'

// Границу публикуемого держит не список сам по себе — держит её то, что
// каждое чтение проходит проверку «путь лежит под объявленным входом, не из
// запретного списка и без символических звеньев». Список для примера
// ai-advent-2026 прибит тестом: он равен списку исходного пакета на 1d882f4.

const EXPECTED = [
  'agent_docs/adr',
  'agent_docs/development-history',
  'agent_docs/design',
  'agent_docs/guides',
  'agent_docs/architecture.md',
  'agent_docs/index.md',
  'agent_docs/glossary.md',
  'AGENTS.md',
  'agent_docs/invariants.md',
  '.claude/agents',
  '.agents/skills',
  'skills-lock.json',
  'days',
  'deploy/compose.yml',
  'deploy/Caddyfile',
  'site/index.html',
  'router/config/providers.json',
  'atlas/overlay.json',
]

const example = loadConfig(EXAMPLE_CONFIG).config
const guard = makeGuard(example)
const fixtureConfig = (root) => loadConfig(join(root, 'atlas.config.json')).config

test('входы примера — ровно список исходного пакета', () => {
  assert.deepEqual(guard.inputs.slice().sort(), EXPECTED.slice().sort())
  assert.deepEqual(resolveInputs(example).listOnly, ['days'])
})

test('среди входов примера нет ни одного запретного пути', () => {
  const forbidden = [/(^|\/)\.env/, /\.env$/, /^temp\//, /^logs\//, /(^|\/)data(\/|$)/, /\.sqlite/]
  for (const p of guard.inputs) {
    for (const re of forbidden) assert.equal(re.test(p), false, `вход ${p} попадает под запрет ${re}`)
  }
})

test('чтение мимо списка входов не проходит', () => {
  for (const rel of ['deploy/secrets.env', '.env', 'temp/x.json', 'logs/app.log', 'router/data/ledger.jsonl', 'days/day1/server.js']) {
    assert.equal(guard.isInput(rel), false, rel)
  }
  for (const rel of ['agent_docs/adr/2026-01-01-0000-x.md', '.agents/skills/x/SKILL.md', 'AGENTS.md', 'deploy/compose.yml']) {
    assert.equal(guard.isInput(rel), true, rel)
  }
  // Каталог единиц только перечисляется: код приложений в граф не читается.
  assert.equal(guard.isDir('days'), true)
  assert.equal(guard.isInput('days/day1'), false)
})

test('запретный путь не читается и внутри разрешённого каталога', () => {
  for (const rel of ['agent_docs/adr/keys.env', 'agent_docs/adr/.env.local', 'agent_docs/data/x.md', '.claude/agents/run.log']) {
    assert.equal(guard.isInput(rel), false, rel)
  }
})

test('запретный путь, названный в конфигурации в обход проверки, — находка, файл не читается', () => {
  const fx = copyFixture()
  try {
    const config = { ...fixtureConfig(fx.root), overlay: '.env' }
    writeFileSync(join(fx.root, '.env'), 'SECRET=1\n')
    const src = readSources(fx.root, config)
    assert.ok(src.findings.some((f) => f.file === '.env' && /запретный список/.test(f.message)), JSON.stringify(src.findings))
    assert.equal(JSON.stringify(src).includes('SECRET=1'), false)
    // Мимо списка входов — ошибка программы, не находка.
    assert.equal(makeGuard(config).listed('deploy/secrets.env'), false)
  } finally {
    fx.cleanup()
  }
})

test('запретный путь, встреченный при чтении, — находка, а не падение', () => {
  const fx = copyFixture()
  try {
    // Каталог скилла с именем `data` — обычное имя в чужом дереве.
    for (const name of ['data', 'ok']) {
      mkdirSync(join(fx.root, 'skills', name), { recursive: true })
      writeFileSync(join(fx.root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Скилл.\n---\n# ${name}\n`)
    }
    editConfig(fx.root, (c) => {
      c.agents.skills = 'skills'
    })
    const src = readSources(fx.root, fixtureConfig(fx.root))
    assert.deepEqual(
      src.findings.map((f) => `${f.file}: ${f.message}`),
      ['skills/data/SKILL.md: вход попадает под запретный список: такое не читается никогда'],
    )
    assert.deepEqual(
      src.skills.map((s) => [s.key, s.text === '' ? 'не прочитан' : 'прочитан']),
      [
        ['data', 'не прочитан'],
        ['ok', 'прочитан'],
      ],
    )

    // Файл коллекции с запретным именем: `.env.md` подходит под маску `*.md`.
    writeFileSync(join(fx.root, 'docs/adr/.env.md'), 'SECRET=1\n')
    const dotenv = readSources(fx.root, fixtureConfig(fx.root))
    assert.ok(dotenv.findings.some((f) => f.file === 'docs/adr/.env.md' && /запретный список/.test(f.message)), JSON.stringify(dotenv.findings))
    assert.equal(JSON.stringify(dotenv).includes('SECRET=1'), false)

    // Перечисление запретного каталога — тоже находка (конфигурация в обход проверки).
    const listed = readSources(fx.root, { ...fixtureConfig(fx.root), agents: { ...fixtureConfig(fx.root).agents, roles: 'logs' } })
    assert.ok(listed.findings.some((f) => f.file === 'logs' && /запретный список/.test(f.message)), JSON.stringify(listed.findings))
  } finally {
    fx.cleanup()
  }
})

test('вход, не названный в конфигурации, отсутствует без находки', () => {
  const fx = copyFixture()
  try {
    const src = readSources(fx.root, fixtureConfig(fx.root))
    assert.deepEqual(src.findings, [])
    assert.deepEqual(src.design, [])
    assert.deepEqual(src.skills, [])
    assert.deepEqual(src.days, [])
    assert.deepEqual(src.providers, [])
    assert.equal(src.composeText, '')
    assert.deepEqual(src.skillsLock, { skills: {} })
    assert.equal(src.adr.length, 2)
  } finally {
    fx.cleanup()
  }
})

test('вход, названный в конфигурации, но пропавший, — находка', () => {
  const fx = copyFixture()
  try {
    editConfig(fx.root, (c) => {
      c.docs.guides = 'guides'
    })
    const src = readSources(fx.root, fixtureConfig(fx.root))
    assert.equal(src.findings.length, 1)
    assert.equal(src.findings[0].file, 'docs/guides')
    assert.match(src.findings[0].message, /не читается/)
  } finally {
    fx.cleanup()
  }
})

test('символическая ссылка на файл — находка, файл не читается', () => {
  const fx = copyFixture()
  mkdirSync(TEMP, { recursive: true })
  const outside = mkdtempSync(join(TEMP, 'outside-'))
  try {
    writeFileSync(join(outside, 'secret.md'), '# Чужой файл\n\nSECRET-MARKER\n')
    symlinkSync(join(outside, 'secret.md'), join(fx.root, 'docs/adr/2026-02-01-0000-linked.md'))
    const src = readSources(fx.root, fixtureConfig(fx.root))
    const found = src.findings.find((f) => f.file === 'docs/adr/2026-02-01-0000-linked.md')
    assert.ok(found, JSON.stringify(src.findings))
    assert.match(found.message, /символическая ссылка/)
    assert.equal(JSON.stringify(src).includes('SECRET-MARKER'), false, 'текст по ссылке прочитан')
  } finally {
    fx.cleanup()
    rmSync(outside, { recursive: true, force: true })
  }
})

test('символическая ссылка на каталог — находка, каталог не перечисляется', () => {
  const fx = copyFixture()
  mkdirSync(TEMP, { recursive: true })
  const outside = mkdtempSync(join(TEMP, 'outside-'))
  try {
    writeFileSync(join(outside, 'intruder.md'), '# Чужая роль\n')
    rmSync(join(fx.root, 'agents'), { recursive: true })
    symlinkSync(outside, join(fx.root, 'agents'))
    const src = readSources(fx.root, fixtureConfig(fx.root))
    assert.ok(src.findings.some((f) => f.file === 'agents' && /символическая ссылка/.test(f.message)), JSON.stringify(src.findings))
    assert.deepEqual(src.roles, [])
  } finally {
    fx.cleanup()
    rmSync(outside, { recursive: true, force: true })
  }
})

test('символическое звено выше файла — тоже находка, даже если ведёт внутрь корня', () => {
  const fx = copyFixture()
  try {
    // `real-docs/docs` → настоящий `docs` того же корня: граница не зависит
    // от того, куда ведёт ссылка.
    mkdirSync(join(fx.root, 'real-docs'))
    symlinkSync(join(fx.root, 'docs'), join(fx.root, 'real-docs/docs'))
    editConfig(fx.root, (c) => {
      c.docs.root = 'real-docs/docs'
    })
    const src = readSources(fx.root, fixtureConfig(fx.root))
    assert.ok(
      src.findings.some((f) => f.file === 'real-docs/docs/adr' && /символическая ссылка \(real-docs\/docs\)/.test(f.message)),
      JSON.stringify(src.findings),
    )
    assert.deepEqual(src.adr, [])
  } finally {
    fx.cleanup()
  }
})
