// Входы атласа — явный список путей из конфигурации, а не обход дерева. Это
// не стиль, а граница публикуемого: запретный список (`.env*`, `temp/`,
// `logs/`, `data/`…) не читается никогда, поэтому и попасть в граф не может.
//
// Граница проверяется на каждом чтении и перечислении: путь под разрешённым
// входом, не из запретного списка, ни одного символического звена от корня,
// настоящий путь — под настоящим корнем. Ссылка — находка, файл не читается.
//
// Битый или пропавший вход не роняет обязательную проверку голым стеком:
// он возвращается находкой, как и битая ссылка. Вход, не названный в
// конфигурации, просто отсутствует — без находки.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { denied, resolveInputs, unitNumber } from './config.js'

/**
 * Страж чтения по разрешённому списку. Список описывает намерение, гарантию
 * даёт то, что мимо стража ничего не читается. Каталог единиц в чтение не
 * входит — оттуда берутся только имена.
 */
export function makeGuard(config) {
  const { read, listOnly } = resolveInputs(config)
  const listed = (rel) => read.some((d) => rel === d || rel.startsWith(`${d}/`))
  const listedDir = (rel) => read.includes(rel) || listOnly.includes(rel)
  return {
    inputs: [...read, ...listOnly],
    /** Под входом из списка — без оглядки на запретный список: мимо списка — ошибка программы. */
    listed,
    listedDir,
    isInput: (rel) => !denied(rel) && listed(rel),
    isDir: (rel) => !denied(rel) && listedDir(rel),
  }
}

/** Запретный путь внутри разрешённого входа — находка, а не падение: так бывает в чужом дереве. */
const deniedFinding = (rel) => ({ file: rel, line: 1, message: 'вход попадает под запретный список: такое не читается никогда' })

/**
 * Причина не читать путь, или null. Каждый компонент от корня — `lstat`:
 * символическая ссылка уводила бы чтение за границу списка, даже когда
 * имя пути в нём есть. Настоящий путь сверяется с настоящим корнем.
 * Пропавший файл бросает ENOENT — вызывающий превращает его в находку.
 */
function unsafe(root, realRoot, rel) {
  let at = root
  const walked = []
  for (const part of rel.split('/')) {
    at = join(at, part)
    walked.push(part)
    if (lstatSync(at).isSymbolicLink()) {
      return `вход — символическая ссылка (${walked.join('/')}): по ссылкам граница входов не идёт, файл не читается`
    }
  }
  const real = realpathSync(at)
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return 'вход лежит вне корня репозитория: не читается'
  return null
}

/**
 * Читает все входы графа из корня репозитория.
 * @param {string} root корень репозитория
 * @param {object} config разрешённая конфигурация (lib/config.js)
 */
export function readSources(root, config) {
  const guard = makeGuard(config)
  const realRoot = realpathSync(root)
  const findings = []
  // Абсолютный путь раннера в сообщении бесполезен: файл уже назван в
  // поле `file`, а корень у каждой машины свой.
  const fail = (rel, error) =>
    findings.push({ file: rel, line: 1, message: `вход не читается: ${error.message.replaceAll(`${root}/`, '')}` })

  const text = (rel, fallback = '') => {
    if (!guard.listed(rel)) throw new Error(`чтение мимо списка входов: ${rel}`)
    if (denied(rel)) {
      findings.push(deniedFinding(rel))
      return fallback
    }
    try {
      const why = unsafe(root, realRoot, rel)
      if (why) {
        findings.push({ file: rel, line: 1, message: why })
        return fallback
      }
      return readFileSync(join(root, rel), 'utf8')
    } catch (error) {
      fail(rel, error)
      return fallback
    }
  }
  const json = (rel, fallback) => {
    const raw = text(rel, null)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw)
    } catch (error) {
      findings.push({ file: rel, line: 1, message: `вход не разбирается как JSON: ${error.message}` })
      return fallback
    }
  }
  const names = (rel) => {
    if (!guard.listedDir(rel)) throw new Error(`перечисление мимо списка входов: ${rel}`)
    if (denied(rel)) {
      findings.push(deniedFinding(rel))
      return []
    }
    try {
      const why = unsafe(root, realRoot, rel)
      if (why) {
        findings.push({ file: rel, line: 1, message: why })
        return []
      }
      return readdirSync(join(root, rel))
    } catch (error) {
      fail(rel, error)
      return []
    }
  }

  /** Файлы `*.md` каталога, кроме README. Каталога нет в конфигурации — пусто. */
  const markdownFiles = (dir) =>
    dir === null
      ? []
      : names(dir)
          .filter((f) => f.endsWith('.md') && f !== 'README.md')
          .sort()
          .map((f) => ({ key: basename(f, '.md'), path: `${dir}/${f}`, text: text(`${dir}/${f}`) }))

  const { docs, agents, units, deploy } = config

  const unitDirs = units
    ? names(units.dir)
        .filter((d) => units.re.test(d))
        .sort((a, b) => unitNumber(config, a) - unitNumber(config, b))
    : []

  const skills = agents.skills
    ? names(agents.skills)
        .filter((d) => existsSync(join(root, agents.skills, d, 'SKILL.md')))
        .sort()
        .map((d) => ({ key: d, path: `${agents.skills}/${d}/SKILL.md`, text: text(`${agents.skills}/${d}/SKILL.md`) }))
    : []

  const roles = agents.roles
    ? names(agents.roles)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => ({ key: basename(f, '.md'), path: `${agents.roles}/${f}`, text: text(`${agents.roles}/${f}`) }))
    : []

  const guides = [
    ...markdownFiles(docs.guides),
    ...docs.rootDocs.map((p) => ({ key: basename(p, '.md').toLowerCase(), path: p, text: text(p) })),
  ]

  const overlayText = config.overlay ? text(config.overlay, '{}') : '{}'
  // Пустые разделы overlay — не отсутствие полей, а честный «ничего нет»:
  // иначе битый overlay падал бы стеком вместо находки.
  const EMPTY_OVERLAY = { classes: [], phases: [], externals: [], calls: [], publishes: [], about: {} }
  let overlay = EMPTY_OVERLAY
  try {
    overlay = { ...EMPTY_OVERLAY, ...JSON.parse(overlayText) }
  } catch (error) {
    findings.push({ file: config.overlay, line: 1, message: `вход не разбирается как JSON: ${error.message}` })
  }

  const optional = (rel) => (rel ? text(rel) : '')

  return {
    root,
    findings,
    adr: markdownFiles(docs.adr),
    history: markdownFiles(docs.history),
    design: markdownFiles(docs.design),
    guides,
    roles,
    skills,
    units: unitDirs,
    invariants: optional(docs.invariants),
    composeText: optional(deploy.compose),
    caddyText: optional(deploy.caddyfile),
    landingText: optional(deploy.landing),
    providers: deploy.providers ? json(deploy.providers.file, []) : [],
    skillsLock: agents.skillsLock ? json(agents.skillsLock, { skills: {} }) : { skills: {} },
    overlayText,
    overlay,
  }
}

/** Существует ли файл входа — для проверки ссылок. */
export function inputExists(root, rel) {
  return existsSync(join(root, rel))
}
