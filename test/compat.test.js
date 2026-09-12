import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { EXAMPLE_CONFIG, PKG, TEMP } from './helpers.js'
import { compareOutputs, normalizeGraph } from './rename-map.js'

// Формат 2 — docs/input-spec.md: на ai-advent-2026 при 1d882f4 с
// конфигурацией примера выходы равны `node atlas/build.js` в том же checkout
// **с точностью до карты переименования** (docs/migration-plan.md). Карта —
// одна реализация, `test/rename-map.js`; здесь она только применяется.
//
// Пропускается без ATLAS_REFERENCE_ROOT — пути к чистому checkout эталона.

const REF = process.env.ATLAS_REFERENCE_ROOT ? resolve(process.env.ATLAS_REFERENCE_ROOT) : null
const SHA = '1d882f40f8c37370b4dfbc3add650f10d1b11c1c'
const skip = REF === null && 'ATLAS_REFERENCE_ROOT не задан: сравнение с исходным пакетом пропущено'

/**
 * Файлы, которым разрешено отличаться, и в чём именно. Функция получает
 * наш и эталонный текст и отвечает, сводится ли разница к названной.
 */
const EXCEPTIONS = {
  // Данные проекта едут в страницу тегами meta (§10.4), и в комментарии о
  // путях «дни» стали «приложениями» (формат 2). Других отличий нет.
  'site/index.html': (ours, ref) =>
    ours
      .split('\n')
      .filter((l) => !l.startsWith('<meta name="atlas-'))
      .join('\n')
      .replace('что у приложений', 'что у дней') === ref,
  // В коде страницы нет констант проекта: адрес репозитория и документ «как
  // устроено» — из meta; подвал без имени ветки.
  'site/app.js': (ours, ref) => ref.includes("const REPO = 'https://github.com/") && !ours.includes('github.com'),
  // Две разницы, обе названные: генератор — `build.js`, а не `atlas/build.js`
  // (§10.3), и в списке разделов `days/` стал `units/`. Список разделов
  // отсортирован, и переименованная строка встаёт в нём на другое место —
  // поэтому строки сравниваются как множество, а не по порядку.
  'vault/index.md': (ours, ref) => {
    const same = ours.replace('ИСТОЧНИК: build.js', 'ИСТОЧНИК: atlas/build.js').replace('- `units/` —', '- `days/` —')
    const lines = (text) => text.split('\n').sort()
    return lines(same).join('\n') === lines(ref).join('\n')
  },
  // Набор вендорного скилла — `source` его записи в lock-файле (ревью
  // проектирования, B5). Исходный пакет писал `addyosmani/agent-skills` для
  // всех вендорных, а skill-inspector по lock-файлу — из NVIDIA/SkillSpector.
  'vault/skills/skill-inspector.md': (ours, ref) =>
    ours.replace('вендорный набор `NVIDIA/SkillSpector`', 'вендорный набор `addyosmani/agent-skills`') === ref,
}

/** Эти заметки сравнивает не карта, а таблица исключений выше. */
const VAULT_SKIP = ['vault/index.md', 'vault/skills/skill-inspector.md']

const git = (...args) => execFileSync('git', ['-C', REF, ...args], { encoding: 'utf8' }).trim()

const REPAIR = 'git update-index --no-assume-unchanged atlas/overlay.json; git checkout -- atlas/overlay.json'

/**
 * Чистота эталона — по содержимому, а не по `git status`: после аварийного
 * прогона бит `assume-unchanged` скрыл бы подменённый overlay, и `status`
 * молчал бы над чужим файлом. Проверяется до сборки и в `finally`.
 */
function assertReferenceClean(when) {
  const marked = git('ls-files', '-v')
    .split('\n')
    .filter((line) => /^[a-z]/.test(line))
  assert.deepEqual(marked, [], `эталон помечен assume-unchanged (${when}); почините: ${REPAIR}`)
  assert.equal(
    git('hash-object', 'atlas/overlay.json'),
    git('rev-parse', 'HEAD:atlas/overlay.json'),
    `overlay эталона не равен коммиту (${when}); почините: ${REPAIR}`,
  )
}

/** Первая различающаяся строка — чтобы расхождение чинилось по адресу. */
function firstDiff(ours, ref) {
  const a = ours.split('\n')
  const b = ref.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `первая различающаяся строка ${i + 1}:\n  наш:    ${String(a[i]).slice(0, 300)}\n  эталон: ${String(b[i]).slice(0, 300)}`
  }
  return 'построчно различий нет (разница в конце файла)'
}

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => rel.split('\\').join('/'))
    .sort()

let built = null
/** Обе сборки — один раз на файл, в одном окружении (часовой пояс важен для даты коммита). */
function buildBoth() {
  if (built) return built
  assert.equal(git('rev-parse', 'HEAD'), SHA, 'эталон не на 1d882f4')
  assertReferenceClean('до сборки')

  const ref = spawnSync(process.execPath, ['atlas/build.js'], { cwd: REF, encoding: 'utf8' })
  assert.equal(ref.status, 0, `сборка эталона: ${ref.stderr}`)

  const out = join(TEMP, 'compat')
  rmSync(out, { recursive: true, force: true })
  const overlay = join(REF, 'atlas/overlay.json')
  try {
    // Ключ формата 2 в overlay эталона: иначе наша сборка не прочла бы
    // привязку документов к единицам. Форматирование файла сохраняется.
    writeFileSync(overlay, readFileSync(overlay, 'utf8').replaceAll('"days": [', '"units": ['))
    // Признак несохранённых правок остаётся `false`: сравниваются выходы, а
    // не состояние дерева. Бит снимается в `finally`, и это проверяется.
    git('update-index', '--assume-unchanged', 'atlas/overlay.json')
    const ours = spawnSync(process.execPath, [join(PKG, 'build.js'), '--root', REF, '--config', EXAMPLE_CONFIG, '--out', out], { encoding: 'utf8' })
    assert.equal(ours.status, 0, `наша сборка: ${ours.stderr}`)
  } finally {
    git('update-index', '--no-assume-unchanged', 'atlas/overlay.json')
    git('checkout', '--', 'atlas/overlay.json')
    assertReferenceClean('после сборки')
  }
  built = { out, ref: join(REF, 'atlas/dist') }
  return built
}

test('graph.json, texts.json и vault равны эталону с точностью до карты', { skip }, () => {
  const { out, ref } = buildBoth()
  const diff = compareOutputs(ref, out, { skip: VAULT_SKIP })
  assert.equal(diff, null, diff ?? '')
})

test('site/ равен эталону, кроме названных исключений', { skip }, () => {
  const { out, ref } = buildBoth()
  assert.deepEqual(filesUnder(join(out, 'site')), filesUnder(join(ref, 'site')), 'набор файлов site/')
  for (const rel of filesUnder(join(ref, 'site'))) {
    const name = `site/${rel}`
    if (name in EXCEPTIONS) continue
    let ours = readFileSync(join(out, name), 'utf8')
    let theirs = readFileSync(join(ref, name), 'utf8')
    // Копия графа рядом со страницей — тот же граф: сравнивается через карту.
    if (rel === 'graph.json') [ours, theirs] = [normalizeGraph(ours), normalizeGraph(theirs)]
    assert.ok(ours === theirs, `${name}: ${firstDiff(ours, theirs)}`)
  }
})

test('названные исключения отличаются ровно тем, чем названо', { skip }, () => {
  const { out, ref } = buildBoth()
  for (const [name, allowed] of Object.entries(EXCEPTIONS)) {
    const ours = readFileSync(join(out, name), 'utf8')
    const theirs = readFileSync(join(ref, name), 'utf8')
    assert.notEqual(ours, theirs, `${name} больше не отличается — уберите исключение`)
    assert.ok(allowed(ours, theirs), `${name}: разница шире названной\n${firstDiff(ours, theirs)}`)
  }
})

test('явный `"language": "ru"` в конфигурации ничего не меняет', { skip }, () => {
  const { out } = buildBoth()
  const config = join(TEMP, 'compat-ru.config.json')
  writeFileSync(config, `${JSON.stringify({ ...JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8')), language: 'ru' }, null, 2)}\n`)
  const second = join(TEMP, 'compat-ru')
  rmSync(second, { recursive: true, force: true })
  const overlay = join(REF, 'atlas/overlay.json')
  try {
    writeFileSync(overlay, readFileSync(overlay, 'utf8').replaceAll('"days": [', '"units": ['))
    git('update-index', '--assume-unchanged', 'atlas/overlay.json')
    const ours = spawnSync(process.execPath, [join(PKG, 'build.js'), '--root', REF, '--config', config, '--out', second], { encoding: 'utf8' })
    assert.equal(ours.status, 0, `сборка с явным словарём: ${ours.stderr}`)
    // Сравнение с нашей же сборкой по умолчанию: ключ либо не меняет ничего,
    // либо меняет — карта тут ни при чём.
    for (const name of ['graph.json', 'site/texts.json']) {
      const a = readFileSync(join(second, name), 'utf8')
      const b = readFileSync(join(out, name), 'utf8')
      assert.ok(a === b, `${name}: ${firstDiff(a, b)}`)
    }
  } finally {
    git('update-index', '--no-assume-unchanged', 'atlas/overlay.json')
    git('checkout', '--', 'atlas/overlay.json')
    assertReferenceClean('после сборки с явным словарём')
    rmSync(second, { recursive: true, force: true })
    rmSync(config, { force: true })
  }
})

test('эталон остаётся чист по содержимому после всех сборок', { skip }, () => {
  buildBoth()
  assertReferenceClean('после прогона')
})
