// Построение графа проекта: узлы и рёбра по таблицам docs/input-spec.md, §4.
// Источник не меняется — граф извлекается из действующих соглашений
// цитирования. Порт `atlas/lib/extract.js` исходного пакета ai-advent-2026:
// порядок узлов и рёбер прежний построчно, литералы проекта — из конфигурации.

import { posix } from 'node:path'
import { parseCompose } from './compose.js'
import { firedTraces } from './fired.js'
import { depth, layout } from './layout.js'
import {
  atomicId,
  clip,
  firstParagraph,
  heading,
  labeledParagraph,
  makeGrammar,
  parseFrontmatter,
  replacementRefs,
  section,
} from './markdown.js'
import { inputExists } from './sources.js'

/** Id из overlay, которые становятся путями заметок и адресами узлов. */
const OVERLAY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {object} sources входы из lib/sources.js
 * @param {object} config разрешённая конфигурация из lib/config.js
 */
export function buildGraph(sources, config) {
  const { docs, agents, units, deploy, vocab } = config
  const grammar = makeGrammar(config)
  /** Куда относить находки ручных фактов: overlay, а без него — сама конфигурация. */
  const overlayFile = config.overlay ?? config.file
  /** Корневые документы — закрытый список целей цитат: имя файла → путь из конфигурации. */
  const rootDocPath = new Map(docs.rootDocs.map((p) => [p.split('/').at(-1), p]))

  const nodes = []
  const edges = []
  // Находки чтения входов идут первыми: без входа остальные находки — эхо.
  const findings = [...(sources.findings ?? [])]

  const add = (node) => {
    const twin = nodes.find((n) => n.id === node.id)
    if (twin) {
      const where = (n) => n.file ?? n.source ?? overlayFile
      note(where(node), 1, `узел \`${node.id}\` строится дважды: из ${where(twin)} и из ${where(node)}`)
      return twin
    }
    nodes.push(node)
    return node
  }
  const link = (from, to, kind, extra = {}) => {
    edges.push({ from, to, kind, ...extra })
  }
  const has = (id) => nodes.some((n) => n.id === id)
  const note = (file, line, message) => findings.push({ file, line, message })

  // Id ручного факта становится путём заметки vault и адресом страницы.
  const idOk = (id, what) => {
    if (typeof id === 'string' && OVERLAY_ID.test(id)) return true
    note(overlayFile, lineOf(sources.overlayText, `"${id}"`), `id ${what} \`${id}\` не по грамматике ${OVERLAY_ID.source}: он становится путём заметки и адресом узла`)
    return false
  }

  // --- документы: adr, history, design, guide ---------------------------------

  const docNode = (type, entry, key) => {
    const text = entry.text
    const id = `${type}/${key}`
    const date = (key.match(/^(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null
    const excerptSource = vocab.sections.excerpt.map((name) => section(text, name)).find((s) => s) || text.replace(/^#.*\n/, '')
    const node = {
      id,
      type,
      key,
      title: heading(text) || key,
      file: entry.path,
      date,
      excerpt: clip(firstParagraph(excerptSource), 400),
    }
    if (type === 'adr') node.status = clip(firstParagraph(section(text, vocab.sections.status)), 200)
    return add(node)
  }

  for (const entry of sources.adr) {
    const id = atomicId(entry.key)
    if (!id) {
      note(entry.path, 1, 'имя ADR без идентификатора YYYY-MM-DD-HHMM')
      continue
    }
    docNode('adr', entry, id)
  }
  for (const entry of sources.history) {
    const id = atomicId(entry.key)
    if (!id) {
      note(entry.path, 1, 'имя записи истории без идентификатора YYYY-MM-DD-HHMM')
      continue
    }
    docNode('history', entry, id)
  }
  for (const entry of sources.design) docNode('design', entry, entry.key)
  for (const entry of sources.guides) docNode('guide', entry, entry.key)

  // --- инварианты -------------------------------------------------------------

  for (const line of sources.invariants.split('\n')) {
    const m = line.match(/^- \*\*(I-\d+)\.\*\*\s*(.+)$/)
    if (m) add({ id: `invariant/${m[1]}`, type: 'invariant', key: m[1], title: m[1], text: m[2].trim(), file: docs.invariants })
  }
  // Допустимые номера — те, что разобраны из файла. Константы здесь быть не
  // может: добавленный инвариант иначе роняет обязательную проверку на всех PR.
  const invariantNumbers = nodes.filter((n) => n.type === 'invariant').map((n) => Number(n.key.slice(2)))
  const invariantRange =
    invariantNumbers.length > 0 ? `I-${Math.min(...invariantNumbers)}…I-${Math.max(...invariantNumbers)}` : 'ни одного'

  // --- роли и ярусы -----------------------------------------------------------

  const rolesWhere = agents.roles ? `${agents.roles}/` : 'конфигурации: agents.roles не задан'
  const withoutPrefix = (model) =>
    agents.modelPrefix !== '' && model.startsWith(agents.modelPrefix) ? model.slice(agents.modelPrefix.length) : model
  const roleNames = new Set(sources.roles.map((r) => r.key))
  for (const entry of sources.roles) {
    const { data, body } = parseFrontmatter(entry.text)
    const owns = labeledParagraph(body, vocab.labels.owns)
    const never = labeledParagraph(body, vocab.labels.never)
    // Полный id модели (`claude-opus-5[1m]`) несёт скобки — в ключ и адрес идёт безопасная форма.
    const tierKey = `${String(data.model).replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}-${data.effort}`
    add({
      id: `role/${entry.key}`,
      type: 'role',
      key: entry.key,
      title: heading(body) || entry.key,
      file: entry.path,
      model: data.model ?? null,
      effort: data.effort ?? null,
      skills: data.skills ?? [],
      description: data.description ?? '',
      owns,
      never,
    })
    if (!has(`tier/${tierKey}`)) {
      add({ id: `tier/${tierKey}`, type: 'tier', key: tierKey, title: `${withoutPrefix(String(data.model))} / ${data.effort}`, model: data.model, effort: data.effort })
    }
    link(`role/${entry.key}`, `tier/${tierKey}`, 'tier')
  }

  // --- скиллы -----------------------------------------------------------------

  for (const entry of sources.skills) {
    const { data } = parseFrontmatter(entry.text)
    add({
      id: `skill/${entry.key}`,
      type: 'skill',
      key: entry.key,
      title: data.name ?? entry.key,
      file: entry.path,
      description: clip(data.description ?? '', 300),
      vendored: Boolean(sources.skillsLock.skills?.[entry.key]),
    })
  }
  const skillsWhere = agents.skills ? `в ${agents.skills}/` : 'в конфигурации: agents.skills не задан'
  for (const entry of sources.roles) {
    const { data } = parseFrontmatter(entry.text)
    for (const skill of data.skills ?? []) {
      if (has(`skill/${skill}`)) link(`role/${entry.key}`, `skill/${skill}`, 'preloads')
      else note(entry.path, 1, `роль предзагружает скилл \`${skill}\`, которого нет ${skillsWhere}`)
    }
  }

  // --- приложения, сервисы, тома ----------------------------------------------

  const composeWhere = deploy.compose ?? 'конфигурации: deploy.compose не задан'
  const compose = parseCompose(sources.composeText)
  for (const f of compose.findings) note(deploy.compose, f.line, f.message)
  const composeByName = Object.fromEntries(compose.services.map((s) => [s.name, s]))

  const landing = {}
  // Карточка приложения на главной; атлас в том же списке отсеивается по href.
  // Дата на странице не видна: она — атрибут data-date ссылки.
  const hrefOf = units ? new RegExp(`href="\\/(${escape(units.prefix)}\\d+)\\/"`) : null
  for (const block of hrefOf ? sources.landingText.split('<a class="app"').slice(1) : []) {
    const href = block.match(hrefOf)
    if (!href) continue
    landing[href[1]] = {
      title: (block.match(/class="app-text">([^<]*)</) ?? [])[1]?.trim() ?? '',
      date: (block.match(/^[^>]*\sdata-date="([^"]*)"/) ?? [])[1]?.trim() ?? '',
    }
  }

  // Маршрут — сервис compose за `reverse_proxy <service>:<port>` и префикс
  // `handle_path`, внутри блока которого он стоит. Блок узнаётся по глубине
  // скобок: после его `}` префикс сброшен, и `reverse_proxy` под `handle /x/*`
  // или `handle {` чужого префикса не получает. Комментарии Caddyfile
  // упоминают handle_path в пояснении: маршрут — только действующая строка.
  const routes = []
  let prefix = null
  let level = 0
  let prefixLevel = 0
  for (const l of sources.caddyText.split('\n')) {
    if (/^\s*#/.test(l)) continue
    const path = l.match(/handle_path (\/[^\s*]+\/)\*/)
    if (path) [prefix, prefixLevel] = [path[1], level]
    const proxy = l.match(/reverse_proxy ([\w-]+):\d+/)
    if (proxy) routes.push({ prefix, service: proxy[1] })
    level += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length
    if (level <= prefixLevel) prefix = null
  }
  const routeOf = (name) => routes.find((r) => r.service === name)?.prefix ?? null

  for (const name of sources.units) {
    const svc = composeByName[name] ?? { image: null, dependsOn: [], volumes: [], envFiles: [] }
    add({
      id: `unit/${name}`,
      type: 'unit',
      key: name,
      title: landing[name]?.title || name,
      date: landing[name]?.date ?? null,
      dir: `${units.dir}/${name}`,
      route: routeOf(name),
      image: svc.image,
      envFiles: svc.envFiles,
    })
  }

  const isUnit = (name) => units !== null && units.re.test(name)
  for (const s of compose.services) {
    if (isUnit(s.name)) continue
    add({ id: `service/${s.name}`, type: 'service', key: s.name, title: s.name, image: s.image, envFiles: s.envFiles, file: deploy.compose })
  }
  for (const s of deploy.static) {
    add({ id: `service/${s.name}`, type: 'service', key: s.name, title: s.name, source: `${s.dir}/`, file: s.file, note: s.note })
  }

  for (const v of compose.volumes) {
    add({ id: `volume/${v}`, type: 'volume', key: v, title: v, file: deploy.compose })
  }

  // Сервисы, на которые конфигурация ссылается по имени, обязаны быть в compose.
  for (const [field, name] of [
    ['deploy.proxy', deploy.proxy],
    ['deploy.providers.service', deploy.providers?.service],
  ]) {
    if (name && deploy.compose && !composeByName[name]) note(config.file, 1, `\`${field}\`: сервиса \`${name}\` нет в ${deploy.compose}`)
  }

  const unitId = (name) => (isUnit(name) ? `unit/${name}` : `service/${name}`)
  for (const s of compose.services) {
    for (const dep of s.dependsOn) if (has(unitId(dep))) link(unitId(s.name), unitId(dep), 'depends')
    for (const v of s.volumes) if (v.named && has(`volume/${v.source}`)) link(unitId(s.name), `volume/${v.source}`, 'mounts')
  }
  // Два блока на один сервис — один маршрут в графе.
  const proxyId = `service/${deploy.proxy}`
  for (const id of new Set(routes.map((r) => unitId(r.service)))) if (has(id)) link(proxyId, id, 'routes')
  // Прокси отдаёт статику, если монтирует её каталог: путь тома — от каталога compose.
  const proxy = deploy.proxy ? composeByName[deploy.proxy] : undefined
  for (const s of deploy.static) {
    const mounted = (v) => posix.join(posix.dirname(deploy.compose), v.source) === s.dir
    if (proxy?.volumes.some(mounted)) link(proxyId, `service/${s.name}`, 'serves')
  }

  // --- внешние сервисы --------------------------------------------------------

  for (const p of sources.providers) {
    add({
      id: `external/${p.id}`,
      type: 'external',
      key: p.id,
      title: p.model ? `${p.id} (${p.model})` : p.id,
      kind: p.kind,
      tier: p.tier,
      model: p.model,
      source: deploy.providers.file,
    })
    link(`service/${deploy.providers.service}`, `external/${p.id}`, 'calls')
  }
  for (const e of sources.overlay.externals) {
    if (!idOk(e.id, 'внешнего сервиса')) continue
    add({ id: `external/${e.id}`, type: 'external', key: e.id, title: e.title, kind: e.kind, note: e.note, source: config.overlay })
  }
  // Конвейер образов: сборка публикует → реестр → сервер тянет тег.
  if (deploy.registry) {
    const registry = `external/${deploy.registry.external}`
    for (const s of compose.services) {
      if (!s.image?.startsWith(deploy.registry.prefix)) continue
      if (has(registry)) link(unitId(s.name), registry, 'image')
    }
    if (!has(registry)) note(config.file, 1, `\`deploy.registry.external\`: внешнего сервиса \`${deploy.registry.external}\` нет среди externals ${overlayFile}`)
  }
  for (const p of sources.overlay.publishes ?? []) {
    if (!has(`external/${p.from}`) || !has(`external/${p.to}`)) {
      note(overlayFile, lineOf(sources.overlayText, `"${p.from}"`), `в publishes указан внешний сервис, которого нет среди externals`)
      continue
    }
    link(`external/${p.from}`, `external/${p.to}`, 'publishes')
  }
  for (const c of sources.overlay.calls) {
    if (!composeByName[c.from]) {
      note(overlayFile, lineOf(sources.overlayText, `"${c.from}"`), `в calls указан сервис \`${c.from}\`, которого нет в ${composeWhere}`)
      continue
    }
    if (!has(`external/${c.to}`)) {
      note(overlayFile, lineOf(sources.overlayText, `"${c.to}"`), `в calls указан внешний сервис \`${c.to}\`, которого нет среди externals`)
      continue
    }
    link(unitId(c.from), `external/${c.to}`, 'calls')
  }

  // --- классы гейтов и фазы цикла (overlay) -----------------------------------

  const classes = sources.overlay.classes.filter((c) => idOk(c.id, 'класса'))
  for (const c of classes) {
    add({ id: `class/${c.id}`, type: 'class', key: c.id, title: c.title, what: c.what, note: c.note ?? '', source: config.overlay })
  }
  for (const c of classes) {
    for (const role of c.gates) {
      if (roleNames.has(role)) link(`class/${c.id}`, `role/${role}`, 'gates')
      else note(overlayFile, lineOf(sources.overlayText, `"${role}"`), `класс ${c.id} ссылается на роль \`${role}\`, которой нет в ${rolesWhere}`)
    }
  }

  const phases = sources.overlay.phases.filter((p) => {
    if (Number.isInteger(p.n) && p.n > 0) return true
    note(overlayFile, lineOf(sources.overlayText, `"n": ${JSON.stringify(p.n)}`), `номер фазы \`${p.n}\` — не целое число больше нуля: он становится путём заметки`)
    return false
  })
  for (const p of phases) {
    const key = String(p.n).padStart(2, '0')
    add({ id: `phase/${key}`, type: 'phase', key, title: p.title, n: p.n, exit: p.exit, human: Boolean(p.human), source: config.overlay })
  }
  for (const p of phases) {
    const key = String(p.n).padStart(2, '0')
    for (const role of p.roles) {
      if (roleNames.has(role)) link(`phase/${key}`, `role/${role}`, 'runs')
      else note(overlayFile, lineOf(sources.overlayText, `"${role}"`), `фаза ${p.n} ссылается на роль \`${role}\`, которой нет в ${rolesWhere}`)
    }
    for (const cls of p.classes ?? []) {
      if (has(`class/${cls}`)) link(`phase/${key}`, `class/${cls}`, 'runs')
      else note(overlayFile, lineOf(sources.overlayText, `"${cls}"`), `фаза ${p.n} ссылается на класс ${cls}, которого нет в overlay`)
    }
  }

  // --- цитаты: cites, relies, mentions ----------------------------------------

  const resolvePath = (value) => {
    const base = value.split('/').pop()
    if (rootDocPath.has(base)) {
      // Корневой документ из закрытого списка. Путь берётся как написан:
      // `AGENTS.md` лежит в корне, и `agent_docs/AGENTS.md` — другой,
      // несуществующий файл, о чём и должна сказать находка.
      const key = base.replace(/\.md$/, '').toLowerCase()
      const file = value.includes('/') ? value : rootDocPath.get(base)
      // Узел корневого документа строится по списку входов, а не по факту
      // файла, поэтому здесь проверяется именно файл: иначе переименование
      // прошло бы мимо гейта.
      if (!inputExists(sources.root, file)) return { file: null, node: null }
      return { file, node: has(`guide/${key}`) ? `guide/${key}` : null }
    }
    const dir = value.slice(0, value.indexOf('/'))
    const rest = value.slice(value.indexOf('/') + 1)
    if (dir === docs.names.guides) {
      const name = rest.replace(/\.md$/, '')
      return { file: `${docs.guides}/${name}.md`, node: has(`guide/${name}`) ? `guide/${name}` : null }
    }
    if (dir === docs.names.design) {
      const name = rest.replace(/\.md$/, '')
      return { file: `${docs.design}/${name}.md`, node: has(`design/${name}`) ? `design/${name}` : null }
    }
    const folder = dir === docs.names.adr ? docs.adr : docs.history
    const type = dir === docs.names.adr ? 'adr' : 'history'
    const id = atomicId(rest)
    if (!id) return { file: `${folder}/${rest}`, node: null }
    return { file: has(`${type}/${id}`) ? `${folder}/${rest}` : null, node: has(`${type}/${id}`) ? `${type}/${id}` : null, id }
  }

  const citing = [
    ...sources.adr.map((e) => ({ id: `adr/${atomicId(e.key)}`, entry: e })),
    ...sources.history.map((e) => ({ id: `history/${atomicId(e.key)}`, entry: e })),
    ...sources.design.map((e) => ({ id: `design/${e.key}`, entry: e })),
    ...sources.guides.map((e) => ({ id: `guide/${e.key}`, entry: e })),
    ...sources.roles.map((e) => ({ id: `role/${e.key}`, entry: e })),
  ]

  for (const { id, entry } of citing) {
    if (!has(id)) continue
    const seen = new Set()
    for (const c of grammar.scanCitations(entry.text)) {
      if (c.kind === 'adr') {
        const target = `adr/${c.value}`
        if (!has(target)) {
          note(entry.path, c.line, `цитата ADR \`${c.value}\` не разрешается: файла нет в ${docs.adr}/`)
          continue
        }
        if (target !== id) addOnce(seen, () => link(id, target, 'cites'), `cites:${target}`)
      } else if (c.kind === 'path') {
        const r = resolvePath(c.value)
        const exists = r.node !== null || (r.file !== null && inputExists(sources.root, r.file))
        if (!exists) {
          note(entry.path, c.line, `путь \`${c.value}\` не разрешается: такого файла нет`)
          continue
        }
        if (r.node && r.node !== id) addOnce(seen, () => link(id, r.node, 'cites'), `cites:${r.node}`)
      } else if (c.kind === 'invariant') {
        if (!has(`invariant/${c.value}`)) {
          note(entry.path, c.line, `упомянут инвариант ${c.value}, которого нет в ${docs.invariants} (там ${invariantRange})`)
          continue
        }
        addOnce(seen, () => link(id, `invariant/${c.value}`, 'relies'), `relies:${c.value}`)
      } else if (roleNames.has(c.value) && id !== `role/${c.value}`) {
        addOnce(seen, () => link(id, `role/${c.value}`, 'mentions'), `mentions:${c.value}`)
      }
    }
  }

  // --- replaces ---------------------------------------------------------------

  for (const entry of sources.adr) {
    const id = atomicId(entry.key)
    if (!id || !has(`adr/${id}`)) continue
    const { replaces, replacedBy } = replacementRefs(entry.text, vocab)
    for (const other of replaces) {
      if (has(`adr/${other}`)) link(`adr/${id}`, `adr/${other}`, 'replaces')
      else note(entry.path, 1, `в строке замены статуса указан ADR \`${other}\`, которого нет`)
    }
    for (const other of replacedBy) {
      if (has(`adr/${other}`)) link(`adr/${other}`, `adr/${id}`, 'replaces')
      else note(entry.path, 1, `в статусе сказано, что документ заменён ADR \`${other}\`, которого нет`)
    }
  }

  // --- about: документ → единица ------------------------------------------------

  const about = sources.overlay.about ?? {}
  // Имя единицы целым словом в имени файла документа: `…-day3-…`.
  const unitWord = units ? new RegExp(`\\b(${escape(units.prefix)}\\d+)\\b`, 'g') : null
  const unitsWhere = units ? `${units.dir}/` : 'конфигурации: units не задан'
  for (const { id, entry } of citing) {
    if (!has(id) || id.startsWith('guide/') || id.startsWith('role/')) continue
    const key = id.slice(id.indexOf('/') + 1)
    const override = about[key]
    // Ключ формата 1 не читается молча: иначе привязка документов тихо
    // пропала бы при переезде на формат 2. Строка ищется внутри своей записи:
    // записей с `days` бывает несколько, и каждую чинят по своему адресу.
    if (override?.days !== undefined) {
      note(overlayFile, lineAfter(sources.overlayText, `"${key}"`, '"days"'), 'в about ключ `days` переименован в `units` (формат 2)')
    }
    const named = override ? (override.units ?? []) : unitWord ? [...new Set([...entry.key.matchAll(unitWord)].map((m) => m[1]))] : []
    for (const unit of named) {
      if (has(`unit/${unit}`)) link(id, `unit/${unit}`, 'about')
      else note(overlayFile, lineOf(sources.overlayText, `"${unit}"`), `в about указана единица \`${unit}\`, которой нет в ${unitsWhere}`)
    }
  }
  for (const key of Object.keys(about)) {
    if (!has(`adr/${key}`) && !has(`history/${key}`) && !has(`design/${key}`)) {
      note(overlayFile, lineOf(sources.overlayText, `"${key}"`), `в about указан документ \`${key}\`, которого нет`)
    }
  }

  // --- fired: правило → где сработало -----------------------------------------

  for (const entry of sources.history) {
    const id = `history/${atomicId(entry.key)}`
    if (!has(id)) continue
    for (const trace of firedTraces(entry.text, roleNames, vocab)) {
      link(`role/${trace.role}`, id, 'fired', { line: trace.line, excerpt: trace.excerpt, marks: trace.marks })
    }
  }

  // Внешний узел — то, с чем работающая система обменивается. Узел без
  // единого ребра означает, что overlay разошёлся с реальностью: чинится
  // ребром или удалением записи, а не подстройкой списка руками.
  for (const n of nodes) {
    if (n.type !== 'external') continue
    if (edges.some((e) => e.from === n.id || e.to === n.id)) continue
    const manual = n.source === config.overlay
    note(
      manual ? overlayFile : n.source,
      manual ? lineOf(sources.overlayText, `"${n.key}"`) : 1,
      `внешний узел \`${n.key}\` не связан ни с чем: либо его нет в работе системы, либо не хватает ребра`,
    )
  }

  // Координаты — последними: раскладка считается по готовому графу.
  const placed = layout(nodes, edges)
  // Глубина — после плоскости и при зафиксированных x, y. В узле z стоит
  // перед x: так строка y не получает запятую, и diff graph.json до и после —
  // одни добавленные строки "z".
  const deep = depth(nodes, edges, placed)
  for (const node of nodes) Object.assign(node, { z: deep.get(node.id) }, placed.get(node.id))

  return { nodes, edges, findings }
}

/** Ребро добавляется один раз на пару «документ — цель». */
function addOnce(seen, fn, key) {
  if (seen.has(key)) return
  seen.add(key)
  fn()
}

/** Номер строки, где встретилось значение, — чтобы находка правилась по адресу. */
function lineOf(text, needle) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.includes(needle))
  return i === -1 ? 1 : i + 1
}

/**
 * Номер строки, где значение встретилось **после** якоря: одинаковые ключи
 * в разных записях иначе показали бы на первую из них, и правка ушла бы не
 * туда.
 */
function lineAfter(text, anchor, needle) {
  const from = text.indexOf(anchor)
  const at = text.indexOf(needle, from === -1 ? 0 : from)
  return at === -1 ? lineOf(text, needle) : text.slice(0, at).split('\n').length
}
