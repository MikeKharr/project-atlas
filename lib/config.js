// Конфигурация проекта — `atlas.config.json` (docs/input-spec.md, §3). Модуль
// читает файл, проверяет его и отдаёт разрешённую структуру: пути входов и
// имена коллекций. Остальной код файл конфигурации не читает.
//
// Опечатка в ключе не должна молча выключать вход: неизвестный ключ, путь не
// той формы, запретный путь и незаданная зависимость — находки, как битая
// ссылка. Сборка с находками не пишет ничего.

import { readFileSync } from 'node:fs'

/** Файл конфигурации не читается или не JSON: сборка не может начаться (код 2). */
export class ConfigError extends Error {}

const text = { type: 'string' }
const path = (ext) => ({ type: 'path', ext })
const segment = { type: 'segment' }
const req = (spec) => ({ ...spec, required: true })

/** Схема §3.2: вид значения каждого ключа. Ключ вне схемы — находка. */
const SCHEMA = {
  keys: {
    format: req({ type: 'number' }),
    project: req({ keys: { name: req(text), repo: req(text), about: path() } }),
    docs: req({
      keys: {
        root: req(path()),
        adr: req(segment),
        history: segment,
        design: segment,
        guides: segment,
        invariants: path(['.md']),
        rootDocs: { type: 'paths', ext: ['.md'] },
      },
    }),
    agents: { keys: { roles: path(), skills: path(), skillsLock: path(['.json']), modelPrefix: text } },
    units: { keys: { dir: req(path()), prefix: req(text) } },
    deploy: {
      keys: {
        compose: path(['.yml', '.yaml']),
        proxy: text,
        caddyfile: path(),
        landing: path(['.html']),
        static: { items: { name: req(text), dir: req(path()), file: req(path()), note: text } },
        registry: { keys: { prefix: req(text), external: req(text) } },
        providers: { keys: { file: req(path(['.json'])), service: req(text) } },
      },
    },
    overlay: path(['.json']),
  },
}

/** Поле → поля, без которых оно не работает (§3.2, таблица зависимостей). */
const DEPENDS = [
  ['deploy.caddyfile', ['deploy.compose', 'deploy.proxy']],
  ['deploy.landing', ['units']],
  ['deploy.static', ['deploy.compose', 'deploy.proxy']],
  ['deploy.registry', ['deploy.compose', 'overlay']],
  ['deploy.providers', ['deploy.compose']],
  ['agents.skillsLock', ['agents.skills']],
]

/**
 * Сегмент пути: буквы, цифры, `.`, `_`, `-`; не `.` и не `..`. Пробелы,
 * обратный слэш, пустой сегмент (ведущий `/`, `//`) под правило не подходят.
 */
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/

/** Префикс единиц: без цифр, чтобы граница с номером `\d+` была однозначной. */
const UNIT_PREFIX = /^[A-Za-z][A-Za-z_-]*$/

/**
 * Запретный список §3.3: эти пути не читаются никогда, даже если названы.
 * `.env`, `.env.*`, `*.env` в любом каталоге; `temp/`, `logs/`,
 * `node_modules/`, `.git/` в корне; каталог `data` на любой глубине;
 * `*.sqlite`, `*.sqlite-journal`, `*.log`.
 */
export function denied(p) {
  const parts = p.split('/')
  const base = parts.at(-1)
  if (base.startsWith('.env.') || base.endsWith('.env')) return true
  if (['temp', 'logs', 'node_modules', '.git'].includes(parts[0])) return true
  if (parts.includes('data')) return true
  return /\.(?:sqlite|sqlite-journal|log)$/.test(base)
}

/** Путь от корня репозитория по грамматике сегментов. */
export const pathShapeOk = (p) => p.split('/').every((s) => SEGMENT.test(s))

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj)

function lineOf(text, needle) {
  const i = text.split('\n').findIndex((l) => l.includes(needle))
  return i === -1 ? 1 : i + 1
}

/**
 * Проверка разобранного JSON конфигурации.
 * @param {unknown} raw разобранный файл
 * @param {{file:string, text?:string}} where имя файла для находок и его текст — ради номера строки
 * @returns {{config: object|null, findings: Array<{file:string, line:number, message:string}>}}
 */
export function validateConfig(raw, { file, text: source = '' }) {
  const findings = []
  const bad = (name, message) => {
    const key = name.split('.').at(-1).replace(/\[\d+\]$/, '')
    findings.push({ file, line: lineOf(source, `"${key}"`), message: `конфигурация: \`${name}\` — ${message}` })
  }

  const pathOk = (value, name, ext) => {
    if (typeof value !== 'string' || value === '') return bad(name, 'ожидается путь строкой'), false
    if (!pathShapeOk(value)) {
      bad(name, 'путь от корня репозитория: сегменты из букв, цифр, `.`, `_`, `-`; без ведущего `/`, `..` и `.`')
      return false
    }
    if (denied(value)) return bad(name, `путь \`${value}\` из запретного списка: такое не читается никогда`), false
    if (ext && !ext.some((e) => value.endsWith(e))) return bad(name, `ожидается файл ${ext.map((e) => `\`${e}\``).join(' или ')}`), false
    return true
  }

  const walk = (value, spec, name) => {
    if (spec.keys) {
      if (!isObject(value)) return bad(name || 'конфигурация', 'ожидается объект')
      const at = (key) => (name ? `${name}.${key}` : key)
      for (const key of Object.keys(value)) if (!(key in spec.keys)) bad(at(key), 'неизвестный ключ')
      for (const [key, sub] of Object.entries(spec.keys)) {
        if (value[key] === undefined) {
          if (sub.required) bad(at(key), 'обязательное поле не задано')
        } else walk(value[key], sub, at(key))
      }
      return
    }
    if (spec.items) {
      if (!Array.isArray(value)) return bad(name, 'ожидается список')
      value.forEach((item, i) => walk(item, { keys: spec.items }, `${name}[${i}]`))
      return
    }
    if (spec.type === 'number' && typeof value !== 'number') bad(name, 'ожидается число')
    if (spec.type === 'string' && (typeof value !== 'string' || value === '')) bad(name, 'ожидается непустая строка')
    if (spec.type === 'path') pathOk(value, name, spec.ext)
    if (spec.type === 'segment' && pathOk(value, name) && value.includes('/')) bad(name, 'ожидается одно имя каталога, без `/`')
    if (spec.type === 'paths') {
      if (!Array.isArray(value)) return bad(name, 'ожидается список путей')
      value.forEach((p, i) => pathOk(p, `${name}[${i}]`, spec.ext))
    }
  }

  walk(raw, SCHEMA, '')
  // Смысловые правила — только поверх верной формы: иначе они падали бы на
  // значениях не того типа и дублировали находки формы.
  if (findings.length > 0) return { config: null, findings }

  if (raw.format !== 1) bad('format', `поддерживается только формат 1, задан ${JSON.stringify(raw.format)}`)

  for (const [field, needs] of DEPENDS) {
    if (get(raw, field) === undefined) continue
    for (const need of needs) if (get(raw, need) === undefined) bad(field, `требует \`${need}\`, а он не задан`)
  }

  // Грамматика цитат строится из имён коллекций и корневых документов:
  // совпавшие имена сделали бы одну цитату двумя разными ссылками.
  const docs = raw.docs
  const names = ['adr', 'history', 'design', 'guides'].filter((k) => docs[k] !== undefined)
  for (const [i, a] of names.entries()) {
    for (const b of names.slice(i + 1)) if (docs[a] === docs[b]) bad(`docs.${b}`, `имя \`${docs[b]}\` уже занято \`docs.${a}\``)
  }
  const seen = new Map()
  for (const [i, p] of (docs.rootDocs ?? []).entries()) {
    const base = p.split('/').at(-1)
    const clash = names.find((k) => docs[k] === base || docs[k] === base.replace(/\.md$/, ''))
    if (clash) bad(`docs.rootDocs[${i}]`, `имя \`${base}\` совпадает с коллекцией \`docs.${clash}\``)
    const key = base.toLowerCase()
    if (seen.has(key)) bad(`docs.rootDocs[${i}]`, `имя \`${base}\` уже занято \`${seen.get(key)}\``)
    else seen.set(key, p)
  }

  if (raw.units && !UNIT_PREFIX.test(raw.units.prefix)) {
    bad('units.prefix', 'префикс — буквы, `_` и `-`, начинается с буквы; номер единицы идёт сразу за ним')
  }

  if (findings.length > 0) return { config: null, findings }
  return { config: resolve(raw, file), findings }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Проверенная конфигурация → структура, которую читает остальной код. */
function resolve(raw, file) {
  const d = raw.docs
  const under = (name) => (name === undefined ? null : `${d.root}/${name}`)
  const deploy = raw.deploy ?? {}
  const units = raw.units
  return {
    file,
    project: { name: raw.project.name, repo: raw.project.repo, about: raw.project.about ?? null },
    docs: {
      root: d.root,
      /** Имена коллекций как их пишут в цитатах; `null` — коллекции нет. */
      names: { adr: d.adr, history: d.history ?? null, design: d.design ?? null, guides: d.guides ?? null },
      adr: under(d.adr),
      history: under(d.history),
      design: under(d.design),
      guides: under(d.guides),
      invariants: under(d.invariants),
      rootDocs: d.rootDocs ?? [],
    },
    agents: {
      roles: raw.agents?.roles ?? null,
      skills: raw.agents?.skills ?? null,
      skillsLock: raw.agents?.skillsLock ?? null,
      modelPrefix: raw.agents?.modelPrefix ?? '',
    },
    // Имя единицы — префикс и номер: `day7`. Выражение собирается дословно,
    // как было литералом в исходном проекте: `/^day\d+$/`.
    units: units ? { dir: units.dir, prefix: units.prefix, re: new RegExp(`^${escape(units.prefix)}\\d+$`) } : null,
    deploy: {
      compose: deploy.compose ?? null,
      proxy: deploy.proxy ?? null,
      caddyfile: deploy.caddyfile ?? null,
      landing: deploy.landing ?? null,
      static: deploy.static ?? [],
      registry: deploy.registry ?? null,
      providers: deploy.providers ?? null,
    },
    overlay: raw.overlay ?? null,
  }
}

/**
 * Читает и проверяет файл конфигурации. Нечитаемый файл и не-JSON — не
 * находка, а `ConfigError`: сборке не с чем начинать.
 * @param {string} path путь к файлу
 * @param {string} [label] как называть файл в находках
 */
export function loadConfig(path, label = path) {
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    throw new ConfigError(`конфигурация не читается: ${path} (${error.code ?? error.message})`)
  }
  let raw
  try {
    raw = JSON.parse(source)
  } catch (error) {
    throw new ConfigError(`конфигурация не разбирается как JSON: ${path}: ${error.message}`)
  }
  return validateConfig(raw, { file: label, text: source })
}

/**
 * Разрешённый список входов: что читается (файлы и каталоги) и что только
 * перечисляется. Порядок — порядок полей схемы; тесты держат его копию.
 * @returns {{read: string[], listOnly: string[]}}
 */
export function resolveInputs(config) {
  const { docs, agents, units, deploy } = config
  const read = [
    docs.adr,
    docs.history,
    docs.design,
    docs.guides,
    ...docs.rootDocs,
    docs.invariants,
    agents.roles,
    agents.skills,
    agents.skillsLock,
    deploy.compose,
    deploy.caddyfile,
    deploy.landing,
    deploy.providers?.file,
    config.overlay,
  ].filter((p) => p !== null && p !== undefined)
  return { read, listOnly: units ? [units.dir] : [] }
}

/** Номер единицы из имени каталога: всё после префикса (`day7` → 7). */
export function unitNumber(config, name) {
  return Number(name.slice(config.units.prefix.length))
}
