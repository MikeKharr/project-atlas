import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { run } from '../build.js'
import { KEY_SAMPLES, SAMPLES } from '../lib/texts.js'
import { PKG, TEMP, copyFixture } from './helpers.js'

// Витрина не должна расширять публикуемое. Входы заданы явным списком путей,
// поэтому секрет не может попасть в граф даже случайно — но это
// проверяется, а не предполагается: рядом с входами кладутся файлы с
// маркером, и маркера в выходе быть не должно.

const MARKER = 'ATLAS-SECRET-MARKER-8fd31c'
// Префиксы ключей собираются из кусков, а не пишутся литералом: файл теста
// не должен выглядеть утечкой ни для сканеров, ни для шага секретов CI,
// который ищет в репозитории префикс ключа Anthropic с хвостом.
const FAKE_ANTHROPIC = `${['sk', 'ant', 'api03'].join('-')}-${MARKER}`
const FAKE_GROQ = `gs${'k'}_${MARKER}`
// Заголовок PEM и токен GitHub — тоже из кусков.
const PEM = (kind) => ['BEGIN', kind, 'PRIVATE', 'KEY'].filter(Boolean).join(' ')
const TAIL = 'A1b2C3d4E5f6G7h8J9k0'
const GH = (letter) => `gh${letter}_${TAIL}`
const GH_PAT = `${'github'}_pat_${TAIL}_${TAIL}`
const GROQ = `gs${'k'}_${TAIL}`
const ANT_KEY = `${['sk', 'ant', ''].join('-')}${TAIL}`
// Синтетический адрес из диапазона CGNAT, тоже из кусков.
const PRIVATE_NET = ['100', '64', '0', '9'].join('.')

const HISTORY = 'docs/history/2026-01-16-1200-index-rollout.md'

const fixture = copyFixture()
after(() => fixture.cleanup())

// Подложенные секреты рядом со входами: запретный список, логи, данные,
// ключи SSH, файлы окружения. Ни один не назван в конфигурации.
for (const dir of ['deploy', 'logs', 'data', 'docs/adr/data']) mkdirSync(join(fixture.root, dir), { recursive: true })
writeFileSync(join(fixture.root, 'deploy/secrets.env'), `ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}\n`)
writeFileSync(join(fixture.root, 'deploy/router.env'), `GROQ_API_KEY=${FAKE_GROQ}\n`)
writeFileSync(join(fixture.root, '.env'), `DEPLOY_KEY=${MARKER}\n`)
writeFileSync(join(fixture.root, 'logs/app.log'), `запрос к ${PRIVATE_NET} с ключом ${MARKER}\n`)
writeFileSync(join(fixture.root, 'data/ledger.jsonl'), `{"key":"${MARKER}"}\n`)
writeFileSync(join(fixture.root, 'docs/adr/data/2026-02-01-0000-ledger.md'), `# Данные\n\n${MARKER}\n`)
writeFileSync(join(fixture.root, 'docs/adr/keys.env'), `KEY=${MARKER}\n`)
writeFileSync(join(fixture.root, 'id_ed25519'), `-----${PEM('OPENSSH')}-----\n${MARKER}\n`)
writeFileSync(join(fixture.root, 'id_rsa'), `-----${PEM('RSA')}-----\n${MARKER}\n`)
writeFileSync(join(fixture.root, 'deploy/gh.env'), `GH_TOKEN=${GH('p')}\nGH_PAT=${GH_PAT}\n# ${MARKER}\n`)

const out = join(fixture.root, 'dist')
const result = run({ root: fixture.root, out })

/** Все файлы каталога выхода, а не одна строка графа: витрина и vault пишут свои файлы. */
const filesIn = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((rel) => join(dir, rel))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const site = filesIn(result.siteDir)
const vault = filesIn(result.vaultDir)

test('сборка на копии с секретами рядом проходит без находок', () => {
  assert.deepEqual(result.findings, [])
  assert.ok(result.nodes.length > 5)
  assert.ok(site.some((f) => f.path.endsWith('graph.json')), 'витрина собрана')
  assert.ok(vault.length > 5, 'vault собран')
})

test('маркер из подложенных секретов не попал ни в один файл витрины и vault', () => {
  for (const f of [...site, ...vault]) assert.equal(f.text.includes(MARKER), false, `маркер в ${f.path}`)
})

// Образцы стража — тот же список, по которому `lib/texts.js` скрывает их в
// texts.json: разойтись двум копиям негде.
const patterns = SAMPLES.map((s) => new RegExp(s))

test('в витрине нет образцов ключей и адресов частной сети', () => {
  for (const f of site) for (const re of patterns) assert.equal(re.test(f.text), false, `в ${f.path} найден образец ${re}`)
})

const NEW_SAMPLES = [PEM('RSA'), PEM('EC'), PEM(''), PEM('ENCRYPTED'), PEM('SSH2 ENCRYPTED'), ...['p', 'o', 'u', 's', 'r'].map(GH), GH_PAT, GROQ, ANT_KEY]

test('страж ловит заголовки PEM, токены GitHub, ключи Groq и Anthropic', () => {
  for (const sample of NEW_SAMPLES) {
    assert.ok(
      patterns.some((re) => re.test(`строка документа: ${sample}.`)),
      `образец не пойман: ${sample}`,
    )
  }
})

// У образцов GitHub хвост обязателен: документ, называющий префикс словами,
// сборку не роняет.
test('упоминание префикса токена GitHub без хвоста — не находка стража', () => {
  for (const text of [`токен \`${'gh'}p_\``, `префикс ${'github'}_pat_ в тексте`]) {
    assert.equal(patterns.some((re) => re.test(text)), false, text)
  }
})

// Шаг «Секреты не попали в репозиторий» — grep в .github/workflows/ci.yml.
// Его образец — ровно KEY_SAMPLES атласа, ни знаком больше.
const CI = join(PKG, '.github/workflows/ci.yml')

test('шаг секретов CI ищет те же образцы с хвостом ключа', () => {
  const yml = readFileSync(CI, 'utf8')
  const grep = yml.match(/grep -rIl --exclude-dir=\.git -E '([^']+)' \./)
  assert.ok(grep, 'в ci.yml не найден шаг grep секретов')
  assert.equal(grep[1], KEY_SAMPLES.join('|'))

  const re = new RegExp(grep[1])
  for (const sample of NEW_SAMPLES) assert.ok(re.test(sample), `шаг не ловит ${sample}`)
  assert.equal(re.test(`токен \`${'gh'}p_\` и ${'github'}_pat_`), false)
  assert.equal(re.test(`слово x${GH('p')}`), false, 'префикс внутри слова')
  assert.ok(re.test(`https://user:${GH('s')}@example.invalid/o/r.git`), 'токен в адресе')
})

// Сам шаг, а не только его образец: скрипт `run: |` выполняется так же, как
// в Actions без `shell:` — `bash -e`.
function secretsStep() {
  const lines = readFileSync(CI, 'utf8').split('\n')
  const name = lines.findIndex((l) => l.includes('name: Секреты не попали в репозиторий'))
  const step = lines.findIndex((l, i) => i > name && /^\s+run: \|$/.test(l))
  const indent = lines[step + 1].match(/^\s*/)[0]
  const body = []
  for (const l of lines.slice(step + 1)) {
    if (l.trim() !== '' && !l.startsWith(indent)) break
    body.push(l.slice(indent.length))
  }
  return body.join('\n')
}

function runStep(dir) {
  try {
    const stdout = execFileSync('bash', ['-e', '-c', secretsStep()], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out: stdout }
  } catch (error) {
    return { code: error.status, out: `${error.stdout}${error.stderr}` }
  }
}

function stepDir(files) {
  mkdirSync(TEMP, { recursive: true })
  const dir = mkdtempSync(join(TEMP, 'secrets-step-'))
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text)
  return dir
}

test('шаг секретов: чистый каталог — ok', () => {
  const dir = stepDir({ 'a.md': 'чисто\n' })
  try {
    const { code, out: log } = runStep(dir)
    assert.equal(code, 0, log)
    assert.match(log, /ok: ключей не найдено/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('шаг секретов: ключ — красный, в журнале имя файла, но не ключ', () => {
  const dir = stepDir({ 'leak.md': `токен ${GH('p')}\n` })
  try {
    const { code, out: log } = runStep(dir)
    assert.equal(code, 1, log)
    assert.match(log, /::error::.*leak\.md/)
    assert.equal(log.includes(TAIL), false, 'ключ в журнале')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Root читает и файл без прав: там код 2 так не воспроизвести.
test('шаг секретов: grep не прочитал файл (код 2) — красный, а не ok', { skip: process.getuid?.() === 0 }, () => {
  const dir = stepDir({ 'a.md': 'чисто\n', 'locked.md': 'нечитаемый\n' })
  chmodSync(join(dir, 'locked.md'), 0o000)
  try {
    const { code, out: log } = runStep(dir)
    assert.notEqual(code, 0, log)
    assert.match(log, /::error::проверка секретов не выполнилась/)
    assert.doesNotMatch(log, /ok: ключей не найдено/)
  } finally {
    chmodSync(join(dir, 'locked.md'), 0o600)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ключ Anthropic с хвостом в документе — находка сборки', () => {
  const leak = copyFixture()
  try {
    appendFileSync(join(leak.root, HISTORY), `\n## Ключ\n\n${ANT_KEY}\n`)
    const checked = run({ root: leak.root, check: true })
    assert.equal(checked.findings.length, 1)
    assert.equal(checked.findings[0].file, HISTORY)
    assert.equal(checked.findings[0].message.includes(TAIL), false, 'ключ в сообщении')
  } finally {
    leak.cleanup()
  }
})

test('ключ в документе — находка сборки и --check, витрина и vault не записаны', () => {
  const leak = copyFixture()
  try {
    appendFileSync(join(leak.root, HISTORY), `\n## Токен\n\n${GH('p')}\n`)
    const leakOut = join(leak.root, 'dist')

    const checked = run({ root: leak.root, check: true })
    assert.equal(checked.findings.length, 1)
    assert.equal(checked.findings[0].file, HISTORY)
    assert.equal(checked.findings[0].message.includes(TAIL), false, 'ключ в сообщении')

    const built = run({ root: leak.root, out: leakOut })
    assert.equal(built.findings.length, 1)
    assert.equal(existsSync(join(built.siteDir, 'texts.json')), false)
    assert.equal(existsSync(join(built.siteDir, 'graph.json')), false)
    assert.equal(existsSync(built.vaultDir), false)
  } finally {
    leak.cleanup()
  }
})

test('секрет, дописанный в сам входной документ, — уже не наша граница', () => {
  // Честная граница: атлас не читает секретные файлы, но всё, что владелец
  // сам положил в документ, в граф попадёт. Проверяется, что это так и
  // есть, — чтобы тесты выше не выглядели гарантией шире, чем они дают.
  const file = join(fixture.root, HISTORY)
  const saved = readFileSync(file, 'utf8')
  // «Контекст» — первый источник выдержки: маркер уходит в graph.json.
  appendFileSync(file, `\n## Контекст\n\n${MARKER}\n`)
  try {
    const second = run({ root: fixture.root, out })
    assert.equal(JSON.stringify(second.nodes).includes(MARKER), true)
  } finally {
    writeFileSync(file, saved)
  }
})
