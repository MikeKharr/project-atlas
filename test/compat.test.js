import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { EXAMPLE_CONFIG, PKG, TEMP } from './helpers.js'

// Формат 1 — docs/input-spec.md: на ai-advent-2026 при 1d882f4 с
// конфигурацией примера `graph.json` и `texts.json` байт-в-байт равны
// `node atlas/build.js` в том же checkout. Витрина и vault равны тоже, кроме
// исключений ниже; каждое исключение проверяется, а не просто пропускается.
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
  // Данные проекта едут в страницу тегами meta (§10.4): других отличий нет.
  'site/index.html': (ours, ref) => ours.split('\n').filter((l) => !l.startsWith('<meta name="atlas-')).join('\n') === ref,
  // В коде страницы нет констант проекта: адрес репозитория и документ «как
  // устроено» — из meta; подвал без имени ветки.
  'site/app.js': (ours, ref) => ref.includes("const REPO = 'https://github.com/") && !ours.includes('github.com'),
  // Генератор — build.js, а не atlas/build.js (§10.3).
  'vault/index.md': (ours, ref) => ours.replace('ИСТОЧНИК: build.js', 'ИСТОЧНИК: atlas/build.js') === ref,
  // Набор вендорного скилла — `source` его записи в lock-файле (ревью
  // проектирования, B5). Исходный пакет писал `addyosmani/agent-skills` для
  // всех вендорных, а skill-inspector по lock-файлу — из NVIDIA/SkillSpector.
  'vault/skills/skill-inspector.md': (ours, ref) =>
    ours.replace('вендорный набор `NVIDIA/SkillSpector`', 'вендорный набор `addyosmani/agent-skills`') === ref,
}

const git = (...args) => execFileSync('git', ['-C', REF, ...args], { encoding: 'utf8' }).trim()

/** Первая различающаяся строка — чтобы расхождение чинилось по адресу. */
function firstDiff(ours, ref) {
  const a = ours.split('\n')
  const b = ref.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `первая различающаяся строка ${i + 1}:\n  наш:    ${String(a[i]).slice(0, 300)}\n  эталон: ${String(b[i]).slice(0, 300)}`
  }
  return 'построчно различий нет (разница в конце файла)'
}

/** texts.json — одна строка: для сообщения она режется по документам. */
const byDocument = (s) => s.replace(/","/g, '",\n"')

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
  assert.equal(git('status', '--porcelain'), '', 'в эталоне есть правки: сравнивать не с чем')
  const ref = spawnSync(process.execPath, ['atlas/build.js'], { cwd: REF, encoding: 'utf8' })
  assert.equal(ref.status, 0, `сборка эталона: ${ref.stderr}`)
  assert.equal(git('status', '--porcelain'), '', 'сборка эталона оставила правки')

  const out = join(TEMP, 'compat')
  rmSync(out, { recursive: true, force: true })
  const ours = spawnSync(process.execPath, [join(PKG, 'build.js'), '--root', REF, '--config', EXAMPLE_CONFIG, '--out', out], { encoding: 'utf8' })
  assert.equal(ours.status, 0, `наша сборка: ${ours.stderr}`)
  built = { out, ref: join(REF, 'atlas/dist') }
  return built
}

test('graph.json байт-в-байт равен исходному пакету', { skip }, () => {
  const { out, ref } = buildBoth()
  const ours = readFileSync(join(out, 'graph.json'), 'utf8')
  const theirs = readFileSync(join(ref, 'graph.json'), 'utf8')
  assert.ok(ours === theirs, firstDiff(ours, theirs))
})

test('texts.json байт-в-байт равен исходному пакету', { skip }, () => {
  const { out, ref } = buildBoth()
  const ours = readFileSync(join(out, 'site/texts.json'), 'utf8')
  const theirs = readFileSync(join(ref, 'site/texts.json'), 'utf8')
  assert.ok(ours === theirs, firstDiff(byDocument(ours), byDocument(theirs)))
})

test('site/ и vault/ равны исходному пакету, кроме названных исключений', { skip }, () => {
  const { out, ref } = buildBoth()
  for (const dir of ['site', 'vault']) {
    assert.deepEqual(filesUnder(join(out, dir)), filesUnder(join(ref, dir)), `набор файлов ${dir}/`)
    for (const rel of filesUnder(join(ref, dir))) {
      const name = `${dir}/${rel}`
      const ours = readFileSync(join(out, name), 'utf8')
      const theirs = readFileSync(join(ref, name), 'utf8')
      if (name in EXCEPTIONS) {
        assert.notEqual(ours, theirs, `${name} больше не отличается — уберите исключение`)
        assert.ok(EXCEPTIONS[name](ours, theirs), `${name}: разница шире названной\n${firstDiff(ours, theirs)}`)
      } else {
        assert.ok(ours === theirs, `${name}: ${firstDiff(ours, theirs)}`)
      }
    }
  }
})
