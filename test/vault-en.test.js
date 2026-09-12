import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { run } from '../build.js'
import { FIXTURE_EN, copyFixture } from './helpers.js'

// Теги статуса ADR в заметках vault читаются словарём (docs/input-spec.md,
// §8). На русской фикстуре этот путь проходил бы и с захардкоженным русским
// словом — пробел, найденный ревью. Здесь он закрыт: сборка английской
// фикстуры и статусы, узнанные английским словарём.

const fx = copyFixture(FIXTURE_EN)
after(() => fx.cleanup())
const OUT = join(fx.root, 'dist')

const vault = () => run({ root: fx.root, out: OUT }).vaultDir
const noteOf = (dir, key) => readFileSync(join(dir, 'adr', `${key}.md`), 'utf8')
const tagsOf = (text) => (text.match(/^tags: \[(.*)\]$/m)?.[1] ?? '').split(', ').filter(Boolean)

test('английский статус даёт тег: Accepted и Superseded', () => {
  const dir = vault()
  assert.ok(tagsOf(noteOf(dir, '2026-01-15-1000')).includes('status/accepted'), 'нет status/accepted у принятого ADR')
  assert.ok(tagsOf(noteOf(dir, '2026-01-10-0900')).includes('status/superseded'), 'нет status/superseded у заменённого ADR')
})

test('русское слово статуса под словарём `en` тегом не становится', () => {
  // Отрицательный контроль: словарь `en` не знает слова `Принято`, и заметка
  // остаётся без тега статуса — а не получает русский тег «за компанию».
  const file = join(fx.root, 'docs/adr/2026-01-15-1000-indexed-storage.md')
  const saved = readFileSync(file, 'utf8')
  try {
    writeFileSync(file, saved.replace(/^Accepted\. Supersedes .*$/m, 'Принято.'))
    const tags = tagsOf(noteOf(vault(), '2026-01-15-1000'))
    assert.deepEqual(
      tags.filter((tag) => tag.startsWith('status/')),
      [],
      `теги заметки: ${tags.join(', ')}`,
    )
  } finally {
    writeFileSync(file, saved)
  }
})
