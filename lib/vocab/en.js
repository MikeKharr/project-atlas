// Английский словарь соглашений документов (docs/input-spec.md, §8).
// Близнец `ru.js` ключ в ключ: всё, что грамматика узнаёт по смыслу, а не по
// форме. Значения — источники регулярных выражений; менять их — менять формат.
//
// Слова — обычные для английских ADR и журналов изменений: `Status` и
// `Context` по Найгарду, `Supersedes` / `Superseded by` в строках замены,
// вердикты ревью этого проекта по-английски.

export default {
  /** Буква слова: латиница, цифры и `_` — как `\w`, но явным списком. */
  letters: 'A-Za-z0-9_',
  sections: {
    /** Раздел статуса ADR и строк замены. */
    status: 'Status',
    /** Источник выдержки узла — первый непустой из разделов, по порядку. */
    excerpt: ['Context', 'What was done', 'Task'],
  },
  /** Помеченные абзацы файла роли: `**Метка:** …`. */
  labels: { owns: 'Owns', never: 'Never' },
  replaces: 'Supersedes',
  replacedBy: 'Superseded\\s+by',
  /** Первое слово статуса ADR → тег vault; сверяется без учёта регистра. */
  status: { accepted: 'Accepted', proposed: 'Proposed', rejected: 'Rejected', superseded: 'Superseded' },
  // `placeholder` не задан намеренно: ключ необязателен. Слово `name` дало бы
  // в грамматике `\bname\b`, и цитаты вроде `guides/name-format.md` или ADR
  // `2026-01-01-0000-name-service.md` молча перестали бы быть цитатами.
  // Литерал `name.md` в заглушках шаблона есть и без словаря.
  fired: {
    /** Признак срабатывания гейта. */
    marks: ['veto(?:ed)?', 'blocking', 'findings?', 'changes\\s+requested', 'request(?:ed)?\\s+changes', 'rework'],
    /** Отрицание в том же фрагменте отменяет след. */
    negations: [
      'no',
      'none',
      'without\\s+(?:a\\s+)?(?:veto|findings|blockers|changes|rework)',
      '(?:did|does)\\s+not\\s+(?:veto|block|request|find)',
    ],
  },
}
