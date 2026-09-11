#!/usr/bin/env node
// Сборка атласа проекта: граф, витрина и vault по конфигурации проекта
// (docs/input-spec.md). `--check` ничего не пишет и падает на любой
// находке; обычный запуск пишет `<out>/graph.json`, `<out>/site/` и
// `<out>/vault/`.

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError, loadConfig, resolveInputs } from './lib/config.js'
import { buildGraph } from './lib/extract.js'
import { readSources } from './lib/sources.js'
import { buildTexts } from './lib/texts.js'
import { VAULT_DIRS, buildVault } from './lib/vault.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Сколько находок печатать: остальное — эхо первых, список должен читаться. */
const SHOWN = 50

/**
 * Метка каталога выхода. Сборка удаляет `site/` и каталоги vault с
 * обычными именами (`adr`, `days`, `roles`…) — только там, где каталог
 * выхода пуст, ещё не существует или уже помечен ею же.
 */
export const MARKER = '.project-atlas'
const MARKER_TEXT = 'Каталог выхода project-atlas: сборка пересоздаёт здесь site/ и каталоги vault.\n'

/** Сборка не может начаться: неверные аргументы или каталог выхода (код 2). */
export class UsageError extends Error {}

/**
 * Всё, что сборка пишет и удаляет, лежит под заданным каталогом. Предикат
 * точный, а не совпадение подстроки: `dist/../../.ssh` — тоже строка,
 * начинающаяся с `dist`, а `dist-2` — тоже начинается с `dist`.
 */
export function underDir(dir, path) {
  const root = resolve(dir)
  const full = resolve(path)
  // `/` уже кончается разделителем: `root + sep` дал бы `//`, и под корнем ФС не лежало бы ничего.
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * Настоящий путь, даже если хвоста ещё нет: `realpath` ближайшего
 * существующего предка плюс остаток. На свежем клоне `--out temp/compat`
 * ещё не существует — и это не ошибка.
 */
export function realPath(path) {
  let at = resolve(path)
  const rest = []
  while (!existsSync(at)) {
    const up = dirname(at)
    if (up === at) break
    rest.unshift(basename(at))
    at = up
  }
  return join(realpathSync(at), ...rest)
}

/**
 * Каталог выхода — настоящий путь, проверенный до всякой записи:
 * не корень и не его предок, не пересекается ни с одним входом, и либо
 * пуст (или ещё не существует), либо несёт метку прошлой сборки. Иначе —
 * отказ, и ничего не удалено.
 */
export function checkOut(root, config, out) {
  const realRoot = realpathSync(root)
  const dir = realPath(out)
  if (underDir(dir, realRoot)) throw new UsageError(`каталог выхода ${dir} — корень репозитория или его предок`)
  const { read, listOnly } = resolveInputs(config)
  for (const input of [...read, ...listOnly]) {
    const path = join(realRoot, input)
    if (underDir(dir, path) || underDir(path, dir)) throw new UsageError(`каталог выхода ${dir} пересекается со входом ${input}`)
  }
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new UsageError(`каталог выхода ${dir} — не каталог`)
    const entries = readdirSync(dir)
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new UsageError(`каталог выхода ${dir} не пуст и не помечен ${MARKER}: его создала не сборка, ничего не удалено`)
    }
    // Всё, что сборка удалит или перезапишет, проверяется до первого удаления:
    // символическая ссылка увела бы `rmSync` и запись в чужое дерево.
    for (const rel of [MARKER, 'graph.json', 'site', 'vault', 'vault/index.md', ...VAULT_DIRS.map((d) => `vault/${d}`)]) {
      let link = false
      try {
        link = lstatSync(join(dir, rel)).isSymbolicLink()
      } catch {
        continue
      }
      if (link) throw new UsageError(`в каталоге выхода ${dir} \`${rel}\` — символическая ссылка: по ссылкам сборка не удаляет и не пишет, ничего не удалено`)
    }
  }
  return dir
}

/**
 * Запись одного файла под каталогом выхода. Кроме пути, проверяется ФС:
 * настоящий путь каталога файла лежит под настоящим `<out>`, а сам файл —
 * не символическая ссылка. Иначе подложенная ссылка перезаписала бы чужой файл.
 */
function writeUnder(dir, path, text) {
  if (!underDir(dir, path)) throw new Error(`запись мимо каталога выхода ${dir}: ${path}`)
  mkdirSync(dirname(path), { recursive: true })
  if (!underDir(realpathSync(dir), realpathSync(dirname(path)))) {
    throw new UsageError(`запись мимо каталога выхода ${dir}: каталог ${dirname(path)} ведёт по ссылке наружу`)
  }
  let link = false
  try {
    link = lstatSync(path).isSymbolicLink()
  } catch {
    // Файла ещё нет — писать можно.
  }
  if (link) throw new UsageError(`запись по символической ссылке не делается: ${path}`)
  writeFileSync(path, text)
}

/**
 * Три факта о состоянии репозитория одним обращением к git: коммит, его
 * время и признак несохранённых правок. Только если корень — вершина
 * рабочего дерева git: подкаталог чужого репозитория получил бы коммит,
 * который его не описывает.
 */
function gitFacts(root) {
  try {
    const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (realpathSync(git(['rev-parse', '--show-toplevel'])) !== realpathSync(root)) return null
    return {
      sha: git(['rev-parse', 'HEAD']),
      dirty: git(['status', '--porcelain']) !== '',
      stamp: git(['show', '-s', '--format=%cd', '--date=format:%Y-%m-%d %H:%M %z', 'HEAD']).replace(/([+-]\d{2})00$/, '$1'),
      date: git(['show', '-s', '--format=%cd', '--date=format:%d.%m.%Y', 'HEAD']),
    }
  } catch {
    return null
  }
}

/**
 * Происхождение для блока заметок vault. Время — коммита, а не «сейчас»:
 * иначе каждый прогон давал бы diff во всех заметках. Если в дереве есть
 * несохранённые правки, копия собрана не из коммита, и блок обязан это
 * сказать. Без git происхождение честно говорит, что коммит неизвестен.
 */
export function readProvenance(root, facts = gitFacts(root)) {
  if (facts === null) return { sha: 'вне git', time: 'не определено' }
  return {
    sha: facts.dirty ? `${facts.sha} + несохранённые правки рабочего дерева` : facts.sha,
    time: `на коммит от ${facts.stamp}`,
  }
}

/**
 * Происхождение для подвала витрины: коммит, его дата и признак
 * несохранённых правок. Без git полей нет — подвал это и говорит.
 */
export function pageProvenance(root, facts = gitFacts(root)) {
  if (facts === null) return { sha: null, dirty: false, date: null }
  return { sha: facts.sha, dirty: facts.dirty, date: facts.date }
}

/** Файлы витрины: рядом со страницей ложатся `graph.json` и `texts.json`. */
const WEB_FILES = ['index.html', 'app.js', 'style.css']

const KB = 1024

/**
 * Потолки размера витрины в байтах. При превышении сборка отказывает, а не
 * усекает: усечённый поиск молча врёт.
 */
export const LIMITS = {
  texts: 3072 * KB,
  graph: 1024 * KB,
  // Код страницы — `WEB_FILES` вместе. Общего потолка на `site/` нет.
  page: 256 * KB,
}

/** Размеры сверх потолков — находки, как битая ссылка: сборка не пишет ничего. */
export function sizeFindings(sizes) {
  const over = [
    ['texts', 'texts.json'],
    ['graph', 'graph.json'],
    ['page', `код страницы (${WEB_FILES.join(' + ')})`],
  ].filter(([key]) => sizes[key] > LIMITS[key])
  return over.map(([key, name]) => ({
    file: 'build.js',
    line: 1,
    message: `${name} — ${(sizes[key] / KB).toFixed(1)} КБ при потолке ${LIMITS[key] / KB} КБ. Усечения нет: потолки — LIMITS в build.js`,
  }))
}

const escapeHtml = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * Страница витрины с данными проекта: `<!-- atlas:meta -->` → теги
 * `<meta name="atlas-…">`, которые читает `app.js`; `{{project}}`,
 * `{{repo}}`, `{{repo-label}}` — заголовок и ссылка в `<noscript>`.
 * Пропавший из шаблона маркер — ошибка, а не страница без данных.
 */
export function pageHtml(template, project) {
  const meta = [
    `<meta name="atlas-project" content="${escapeHtml(project.name)}">`,
    `<meta name="atlas-repo" content="${escapeHtml(project.repo)}">`,
    project.about ? `<meta name="atlas-about" content="${escapeHtml(project.about)}">` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const fill = {
    '<!-- atlas:meta -->': meta,
    '{{project}}': escapeHtml(project.name),
    '{{repo}}': escapeHtml(project.repo),
    '{{repo-label}}': escapeHtml(project.repo.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')),
  }
  let html = template
  for (const [token, value] of Object.entries(fill)) {
    if (!html.includes(token)) throw new Error(`в шаблоне страницы нет ${token}`)
    html = html.replaceAll(token, () => value)
  }
  return html
}

/** Как назвать файл конфигурации в находках: от корня, если он внутри корня. */
function configLabel(root, path) {
  const rel = relative(root, path)
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel
}

/**
 * @param {{root?:string, configFile?:string, check?:boolean, out?:string}} options
 *   `out` — каталог выхода; в `--check` он не разрешается и не проверяется.
 */
export function run({ root = process.cwd(), configFile, check = false, out = join(HERE, 'dist') } = {}) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`корень репозитория не каталог: ${root}`)
  const configPath = configFile ?? join(root, 'atlas.config.json')
  const { config, findings: configFindings } = loadConfig(configPath, configLabel(root, configPath))
  if (config === null) {
    return { nodes: [], edges: [], findings: configFindings, out: null, vault: [], vaultDir: null, siteDir: null, texts: null }
  }
  // Выход проверяется до чтения входов: отказ не должен стоить сборки.
  const outDir = check ? null : checkOut(root, config, out)

  const sources = readSources(root, config)
  const graph = buildGraph(sources, config)
  let vault = []

  // Файлы витрины собираются и в `--check`: потолки проверяются на тех же
  // байтах, которые записала бы сборка. Один опрос git на всю сборку.
  const facts = gitFacts(root)
  const json = `${JSON.stringify({ provenance: pageProvenance(root, facts), nodes: graph.nodes, edges: graph.edges }, null, 2)}\n`
  const { texts, hidden, findings: keys } = buildTexts(graph, sources)
  const textsJson = `${JSON.stringify(texts)}\n`
  const web = WEB_FILES.map((file) => {
    const body = readFileSync(join(HERE, 'web', file))
    return [file, file === 'index.html' ? Buffer.from(pageHtml(body.toString('utf8'), config.project)) : body]
  })
  const bytes = (s) => Buffer.byteLength(s)
  // Ключ в документе — отказ, как потолок размера: ничего не пишется.
  graph.findings.push(
    ...keys,
    ...sizeFindings({
      texts: bytes(textsJson),
      graph: bytes(json),
      page: web.reduce((sum, [, body]) => sum + body.length, 0),
    }),
  )

  const siteDir = outDir && join(outDir, 'site')
  const vaultDir = outDir && join(outDir, 'vault')
  if (graph.findings.length === 0 && !check) {
    mkdirSync(outDir, { recursive: true })
    writeUnder(outDir, join(outDir, MARKER), MARKER_TEXT)
    writeUnder(outDir, join(outDir, 'graph.json'), json)

    // Витрина — статика: страница, её код, стили и граф рядом.
    rmSync(siteDir, { recursive: true, force: true })
    // Собственные файлы пакета, а не входы графа: страж входов стережёт то,
    // что атлас читает из репозитория, а свои ассеты `web/` под него не
    // подпадают и мимо него не проходят.
    for (const [file, body] of web) writeUnder(outDir, join(siteDir, file), body)
    writeUnder(outDir, join(siteDir, 'graph.json'), json)
    writeUnder(outDir, join(siteDir, 'texts.json'), textsJson)

    vault = buildVault({ graph, sources, provenance: readProvenance(root, facts), config })
    // Чистятся только свои каталоги: `.obsidian/` создаёт сам Obsidian, там
    // состояние окна пользователя, и сборка его не трогает.
    for (const dir of VAULT_DIRS) {
      const path = join(vaultDir, dir)
      if (!underDir(outDir, path)) throw new Error(`очистка мимо каталога выхода ${outDir}: ${path}`)
      rmSync(path, { recursive: true, force: true })
    }
    for (const file of vault) writeUnder(outDir, join(vaultDir, file.path), file.text)
  }

  const textsInfo = { count: Object.keys(texts).length, bytes: bytes(textsJson), hidden }
  return { ...graph, out: outDir && join(outDir, 'graph.json'), vault, vaultDir, siteDir, texts: textsInfo }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

/** Статика витрины для локального просмотра: стороннего пакета ради четырёх файлов здесь не будет. */
export function serve(dir, port = 8080) {
  const root = resolve(dir)
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^[/\\]+/, '')
    const path = join(root, rel === '' ? 'index.html' : rel)
    if (!underDir(root, path)) {
      res.writeHead(403).end('мимо каталога витрины')
      return
    }
    try {
      const body = readFileSync(path)
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end('нет такого файла')
    }
  })
  // Только локальный интерфейс: без адреса Node слушает `::`, то есть
  // отдаёт статику всей сети.
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `порт ${port} занят` : `витрина не поднялась: ${error.message}`)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => console.log(`витрина на http://127.0.0.1:${port}/ из ${root}`))
  return server
}

/** В Actions находка — аннотация: тогда она видна прямо в diff'е PR. */
function format(f) {
  return process.env.GITHUB_ACTIONS === 'true'
    ? `::error file=${f.file},line=${f.line}::${f.message}`
    : `${f.file}:${f.line}: ${f.message}`
}

/**
 * Узлы без рёбер по типам. Это не находка: вендорный скилл, который ни одна
 * роль не предзагружает, — факт о проекте, а не дефект графа. Но рост числа
 * должен быть виден, поэтому сборка печатает сводку.
 */
function isolated(nodes, edges) {
  const linked = new Set()
  for (const e of edges) {
    linked.add(e.from)
    linked.add(e.to)
  }
  const byType = {}
  for (const n of nodes) if (!linked.has(n.id)) byType[n.type] = (byType[n.type] ?? 0) + 1
  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  if (total === 0) return 'ни одного'
  return `${total} (${Object.entries(byType)
    .sort()
    .map(([t, n]) => `${t} ${n}`)
    .join(', ')})`
}

/** `--root`, `--config`, `--out` со значением; `--check`, `--serve` — флаги. */
export function parseArgs(argv) {
  const opts = { check: false, serve: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') opts.check = true
    else if (arg === '--serve') opts.serve = true
    else if (arg === '--root' || arg === '--config' || arg === '--out') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} требует значения`)
      opts[arg.slice(2)] = value
      i += 1
    } else throw new UsageError(`неизвестный аргумент ${arg}. Использование: node build.js [--root <каталог>] [--config <файл>] [--out <каталог>] [--check] [--serve]`)
  }
  return opts
}

function main(argv) {
  let opts
  let result
  try {
    opts = parseArgs(argv)
    result = run({
      root: resolve(opts.root ?? '.'),
      configFile: opts.config === undefined ? undefined : resolve(opts.config),
      check: opts.check,
      out: opts.out === undefined ? undefined : resolve(opts.out),
    })
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof ConfigError)) throw error
    console.error(error.message)
    return 2
  }
  const { nodes, edges, findings, out, vault, vaultDir, siteDir, texts } = result

  for (const f of findings.slice(0, SHOWN)) console.error(format(f))
  if (findings.length > SHOWN) console.error(`…и ещё ${findings.length - SHOWN} находок`)

  if (findings.length > 0) {
    console.error(`\nнаходок: ${findings.length}. Граф не записан: ссылки чинятся в источнике, а не в атласе.`)
    return 1
  }

  const byType = {}
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
  const shape = Object.entries(byType)
    .sort()
    .map(([t, n]) => `${t} ${n}`)
    .join(', ')

  if (opts.check) console.log(`ok: ссылки разрешаются, находок нет (${nodes.length} узлов, ${edges.length} рёбер)`)
  else {
    console.log(`записано ${out}\n${nodes.length} узлов (${shape}), ${edges.length} рёбер`)
    console.log(`без рёбер: ${isolated(nodes, edges)}`)
    console.log(`vault: ${vault.length} заметок в ${vaultDir}`)
    console.log(`витрина: ${siteDir}`)
    const hidden = Object.entries(texts.hidden)
    const places = hidden.reduce((sum, [, n]) => sum + n, 0)
    console.log(`texts.json: ${texts.count} документов, ${(texts.bytes / 1024).toFixed(1)} КБ; скрыто образцов: ${places} в ${hidden.length} документах`)
    if (opts.serve) {
      serve(siteDir)
      return null
    }
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = main(process.argv.slice(2))
  // `--serve` держит процесс: выход убил бы сервер сразу после запуска.
  if (code !== null) process.exit(code)
}
