import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCompose } from '../lib/compose.js'
import { DEPLOY } from './helpers.js'

const text = DEPLOY.compose

// Страж парсера. Парсер узкий: он читает подмножество формата, а не YAML.
// Страж — не пересчёт числа сервисов (это было бы то же чтение файла тем же
// способом, одна ошибка, посчитанная дважды), а требование к самому парсеру:
// встретив в блоке сервиса конструкцию не из подмножества, он обязан выдать
// находку. Тогда расширение файла роняет обязательную проверку, а не обедняет
// граф молча.
test('страж: на обычном compose.yml непонятых строк нет', () => {
  assert.deepEqual(parseCompose(text).findings, [])
})

test('страж: непонятая строка в блоке сервиса — находка с номером строки', () => {
  const broken = 'services:\n  a:\n    image: x\n    <<: *base\nvolumes:\n'
  const { findings } = parseCompose(broken)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].line, 4)
  assert.match(findings[0].message, /подмножеств/)
})

test('страж: depends_on в форме отображения не обнуляет зависимости молча', () => {
  const mapping = 'services:\n  a:\n    image: x\n    depends_on:\n      router:\n        condition: service_healthy\nvolumes:\n'
  const { services, findings } = parseCompose(mapping)
  assert.deepEqual(services[0].dependsOn, [])
  assert.equal(findings.length > 0, true, 'форма отображения прошла молча')
  assert.equal(findings[0].line, 5)
  assert.match(findings[0].message, /depends_on/)
})

test('страж: depends_on в поточной форме — находка', () => {
  const flow = 'services:\n  a:\n    image: x\n    depends_on: [router]\nvolumes:\n'
  const { findings } = parseCompose(flow)
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /depends_on/)
})

test('страж: том в длинной форме не теряется молча', () => {
  const long = 'services:\n  a:\n    image: x\n    volumes:\n      - type: volume\n        source: v\n        target: /data\nvolumes:\n  v:\n'
  const { services, findings } = parseCompose(long)
  assert.equal(findings.length > 0, true, 'длинная форма тома прошла молча')
  assert.deepEqual(
    services[0].volumes.filter((v) => v.named),
    [],
  )
})

test('том в короткой форме `имя: {}` — обычная запись, а не находка', () => {
  const short = 'services:\n  a:\n    image: x\n    volumes:\n      - app_data:/data\nvolumes:\n  app_data: {}\n'
  const { volumes, services, findings } = parseCompose(short)
  assert.deepEqual(findings, [])
  assert.deepEqual(volumes, ['app_data'])
  assert.equal(services[0].volumes[0].named, true)
})

test('страж: настройки тома в верхнем блоке — находка', () => {
  const opts = 'services:\n  a:\n    image: x\nvolumes:\n  v:\n    driver: local\n'
  const { findings } = parseCompose(opts)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].line, 6)
})

test('расширение `x-*` — не выход за подмножество', () => {
  const extended = 'services:\n  a:\n    image: x\n    x-owner: platform\nvolumes:\n'
  assert.deepEqual(parseCompose(extended).findings, [])
})

test('состав: по сервису на строку image: и тома верхнего блока', () => {
  const parsed = parseCompose(text)
  const imageLines = text.split('\n').filter((l) => /^ {4}image:/.test(l)).length
  assert.equal(parsed.services.length, imageLines)
  assert.deepEqual(parsed.volumes, ['app1_data', 'gateway_data', 'web_data'])
})

test('зависимости, тома и env_file сервиса разбираются', () => {
  const parsed = parseCompose(text)
  const byName = Object.fromEntries(parsed.services.map((s) => [s.name, s]))

  assert.deepEqual(byName.app1.dependsOn, ['gateway'])
  assert.deepEqual(
    byName.app1.volumes.map((v) => ({ source: v.source, target: v.target })),
    [{ source: 'app1_data', target: '/data' }],
  )
  assert.deepEqual(byName.app1.envFiles, ['./app1.env'])
  assert.equal(byName.web.image, 'proxy:2')
  assert.equal(byName.app1.image, 'registry.invalid/team/app1:latest')
  assert.deepEqual(byName.web.dependsOn, ['app1', 'app2'])
})

test('env_file в длинной форме `path:` читается', () => {
  const long = 'services:\n  a:\n    image: x\n    env_file:\n      - path: ./a.env\n        required: false\nvolumes:\n'
  const parsed = parseCompose(long)
  assert.deepEqual(parsed.findings, [])
  assert.deepEqual(parsed.services[0].envFiles, ['./a.env'])
})

test('bind-монтирование отличается от именованного тома', () => {
  const parsed = parseCompose(text)
  const web = parsed.services.find((s) => s.name === 'web')
  const site = web.volumes.find((v) => v.source === '../public')
  assert.ok(site, 'bind-монтирование статики не найдено')
  assert.equal(site.named, false)
  assert.equal(web.volumes.find((v) => v.source === 'web_data').named, true)
})

test('комментарий в конце строки тома не попадает в цель монтирования', () => {
  const parsed = parseCompose('services:\n  a:\n    volumes:\n      - v:/data      # хвост\nvolumes:\n  v:\n')
  assert.deepEqual(parsed.services[0].volumes, [{ source: 'v', target: '/data', named: true }])
  assert.deepEqual(parsed.findings, [])
})
