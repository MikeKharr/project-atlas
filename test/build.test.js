import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { MARKER, UsageError, pageHtml, parseArgs, readProvenance, run } from '../build.js'
import { FIXTURE, PKG, TEMP, copyFixture, editConfig } from './helpers.js'

// CLI и граница записи: docs/input-spec.md, §2 и §10, с правками ревью
// проектирования (метка каталога выхода, пересечение со входами, realpath).

const BUILD = join(PKG, 'build.js')
// Без GITHUB_ACTIONS: на раннере находки печатаются аннотациями `::error`,
// а тесты сверяют обычный формат `файл:строка: сообщение`.
const cli = (args, cwd = PKG) =>
  spawnSync(process.execPath, [BUILD, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } })

const scratch = () => {
  mkdirSync(TEMP, { recursive: true })
  return mkdtempSync(join(TEMP, 'out-'))
}

test('--check на минимальной фикстуре — код 0, ничего не записано', () => {
  const r = cli(['--root', FIXTURE, '--check'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^ok: ссылки разрешаются, находок нет/)
  assert.equal(existsSync(join(PKG, 'dist')), false, '--check не пишет выход по умолчанию')
})

test('--check не разрешает и не проверяет --out', () => {
  const r = cli(['--root', FIXTURE, '--check', '--out', FIXTURE])
  assert.equal(r.status, 0, r.stderr)
})

test('сборка фикстуры пишет граф, витрину, vault и метку', () => {
  const out = join(scratch(), 'nested', 'fresh')
  try {
    const r = cli(['--root', FIXTURE, '--out', out])
    assert.equal(r.status, 0, r.stderr)
    for (const file of [MARKER, 'graph.json', 'site/index.html', 'site/app.js', 'site/style.css', 'site/graph.json', 'site/texts.json', 'vault/index.md']) {
      assert.ok(existsSync(join(out, file)), file)
    }
    assert.equal(readFileSync(join(out, 'graph.json'), 'utf8'), readFileSync(join(out, 'site/graph.json'), 'utf8'))
  } finally {
    rmSync(join(out, '..', '..'), { recursive: true, force: true })
  }
})

test('--out — корень или его предок: отказ с кодом 2', () => {
  for (const out of ['/', FIXTURE, join(FIXTURE, '..')]) {
    const r = cli(['--root', FIXTURE, '--out', out])
    assert.equal(r.status, 2, `${out}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /корень репозитория или его предок/)
  }
})

test('--out, пересекающийся со входом: отказ', () => {
  const fx = copyFixture()
  try {
    for (const out of [join(fx.root, 'docs/adr/out'), join(fx.root, 'agents')]) {
      assert.throws(() => run({ root: fx.root, out }), (e) => e instanceof UsageError && /пересекается со входом/.test(e.message), out)
    }
    // Каталог внутри корня, но мимо входов, — обычный `dist/`.
    const result = run({ root: fx.root, out: join(fx.root, 'dist') })
    assert.deepEqual(result.findings, [])
  } finally {
    fx.cleanup()
  }
})

test('чужой каталог с site/ без метки — отказ, ничего не удалено', () => {
  const out = scratch()
  try {
    mkdirSync(join(out, 'site'))
    writeFileSync(join(out, 'site', 'precious.txt'), 'не сборки\n')
    mkdirSync(join(out, 'vault', 'adr'), { recursive: true })
    writeFileSync(join(out, 'vault', 'adr', 'mine.md'), 'моё\n')
    const r = cli(['--root', FIXTURE, '--out', out])
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /не пуст и не помечен/)
    assert.ok(existsSync(join(out, 'site', 'precious.txt')))
    assert.ok(existsSync(join(out, 'vault', 'adr', 'mine.md')))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('каталог с меткой пересобирается: устаревшее из site/ удалено, .obsidian не тронут', () => {
  const out = scratch()
  try {
    assert.equal(cli(['--root', FIXTURE, '--out', out]).status, 0)
    writeFileSync(join(out, 'site', 'stale.js'), 'старое\n')
    mkdirSync(join(out, 'vault', '.obsidian'))
    writeFileSync(join(out, 'vault', '.obsidian', 'workspace.json'), '{}\n')
    const r = cli(['--root', FIXTURE, '--out', out])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(join(out, 'site', 'stale.js')), false)
    assert.ok(existsSync(join(out, 'vault', '.obsidian', 'workspace.json')))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('site/ или каталог vault — символическая ссылка: отказ, ничего не удалено', () => {
  for (const rel of ['site', 'vault', 'vault/adr']) {
    const out = scratch()
    const foreign = scratch()
    try {
      assert.equal(cli(['--root', FIXTURE, '--out', out]).status, 0)
      writeFileSync(join(foreign, 'precious.txt'), 'чужое\n')
      rmSync(join(out, rel), { recursive: true, force: true })
      symlinkSync(foreign, join(out, rel))
      const r = cli(['--root', FIXTURE, '--out', out])
      assert.equal(r.status, 2, `${rel}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /символическая ссылка: по ссылкам сборка не удаляет и не пишет, ничего не удалено/)
      assert.ok(existsSync(join(foreign, 'precious.txt')), `${rel}: удалено по ссылке`)
      assert.ok(existsSync(join(out, 'graph.json')), `${rel}: удалено до отказа`)
    } finally {
      rmSync(out, { recursive: true, force: true })
      rmSync(foreign, { recursive: true, force: true })
    }
  }
})

test('graph.json — символическая ссылка: отказ, файл-«жертва» цел', () => {
  const out = scratch()
  const foreign = scratch()
  try {
    assert.equal(cli(['--root', FIXTURE, '--out', out]).status, 0)
    writeFileSync(join(foreign, 'victim.txt'), 'файл пользователя\n')
    rmSync(join(out, 'graph.json'))
    symlinkSync(join(foreign, 'victim.txt'), join(out, 'graph.json'))
    const r = cli(['--root', FIXTURE, '--out', out])
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.equal(readFileSync(join(foreign, 'victim.txt'), 'utf8'), 'файл пользователя\n')
    assert.ok(existsSync(join(out, 'site', 'index.html')), 'удалено до отказа')
  } finally {
    rmSync(out, { recursive: true, force: true })
    rmSync(foreign, { recursive: true, force: true })
  }
})

test('выход внутри корня с подложенной меткой и ссылкой: отказ, файл-«жертва» цел', () => {
  const fx = copyFixture()
  const foreign = scratch()
  try {
    writeFileSync(join(foreign, 'victim.txt'), 'файл пользователя\n')
    mkdirSync(join(fx.root, 'build'))
    writeFileSync(join(fx.root, 'build', MARKER), 'подложено\n')
    symlinkSync(join(foreign, 'victim.txt'), join(fx.root, 'build', 'graph.json'))
    const r = cli(['--root', fx.root, '--out', join(fx.root, 'build')])
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /`graph\.json` — символическая ссылка/)
    assert.equal(readFileSync(join(foreign, 'victim.txt'), 'utf8'), 'файл пользователя\n')
    assert.equal(readFileSync(join(fx.root, 'build', MARKER), 'utf8'), 'подложено\n', 'метка не перезаписана')
  } finally {
    fx.cleanup()
    rmSync(foreign, { recursive: true, force: true })
  }
})

test('нет конфигурации, битый JSON, неверные аргументы — код 2', () => {
  const dir = scratch()
  try {
    assert.equal(cli(['--root', dir, '--check']).status, 2, 'нет atlas.config.json')
    writeFileSync(join(dir, 'atlas.config.json'), '{ "format": 1,')
    const broken = cli(['--root', dir, '--check'])
    assert.equal(broken.status, 2)
    assert.match(broken.stderr, /JSON/)
    assert.equal(cli(['--root', FIXTURE, '--bogus']).status, 2)
    assert.equal(cli(['--root']).status, 2)
    assert.equal(cli(['--root', join(dir, 'нет'), '--check']).status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('находка конфигурации — код 1, ничего не записано', () => {
  const fx = copyFixture()
  const out = scratch()
  try {
    editConfig(fx.root, (c) => {
      c.docs.histroy = 'history'
    })
    const r = cli(['--root', fx.root, '--out', out])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /atlas\.config\.json:\d+: конфигурация: `docs\.histroy` — неизвестный ключ/)
    assert.equal(existsSync(join(out, 'graph.json')), false)
  } finally {
    fx.cleanup()
    rmSync(out, { recursive: true, force: true })
  }
})

test('разбор аргументов', () => {
  assert.deepEqual(parseArgs(['--root', 'r', '--config', 'c.json', '--out', 'o', '--check']), {
    check: true,
    serve: false,
    root: 'r',
    config: 'c.json',
    out: 'o',
  })
  assert.throws(() => parseArgs(['--out', '--check']), UsageError)
  assert.throws(() => parseArgs(['--serve', '9000']), UsageError, 'порт у --serve убран')
})

test('страница: данные проекта в meta, заголовке и noscript; маркеров не осталось', () => {
  const template = readFileSync(join(PKG, 'web/index.html'), 'utf8')
  const html = pageHtml(template, { name: 'Minimal', repo: 'https://example.invalid/team/minimal', about: 'docs/adr/x.md' })
  assert.match(html, /<meta name="atlas-project" content="Minimal">/)
  assert.match(html, /<meta name="atlas-repo" content="https:\/\/example\.invalid\/team\/minimal">/)
  assert.match(html, /<meta name="atlas-about" content="docs\/adr\/x\.md">/)
  assert.match(html, /<title>Атлас проекта Minimal<\/title>/)
  assert.match(html, /<h1 id="title">Атлас проекта Minimal<\/h1>/)
  assert.match(html, /<a href="https:\/\/example\.invalid\/team\/minimal">team\/minimal<\/a>/)
  assert.doesNotMatch(html, /atlas:meta|\{\{/)
  // Без `about` ссылки «как устроено» нет и в данных страницы.
  assert.doesNotMatch(pageHtml(template, { name: 'M', repo: 'https://example.invalid/m' }), /atlas-about/)
})

test('страница: значения экранируются, а `$&` в имени не раскрывается', () => {
  const html = pageHtml('<!-- atlas:meta -->{{project}}{{repo}}{{repo-label}}', { name: 'A & "B" <$&>', repo: 'https://x.invalid/a' })
  assert.ok(html.includes('A &amp; &quot;B&quot; &lt;$&amp;&gt;'))
  assert.throws(() => pageHtml('без маркеров', { name: 'x', repo: 'y' }), /нет <!-- atlas:meta -->/)
})

test('в коде страницы нет значений проекта', () => {
  const app = readFileSync(join(PKG, 'web/app.js'), 'utf8')
  for (const banned of ['github.com', 'mikekharr', 'ai-advent', 'blob/main', 'ветки main']) {
    assert.equal(app.includes(banned), false, banned)
  }
})

test('происхождение — только если корень и есть вершина рабочего дерева git', () => {
  const dir = scratch()
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    git('init', '-q')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'a.md'), 'a\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    assert.match(readProvenance(dir).sha, /^[0-9a-f]{40}$/)
    assert.equal(readProvenance(join(dir, 'sub')).sha, 'вне git', 'подкаталог чужого репозитория')
    writeFileSync(join(dir, 'sub', 'a.md'), 'b\n')
    assert.match(readProvenance(dir).sha, /несохранённые правки рабочего дерева/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
