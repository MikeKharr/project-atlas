import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Корень пакета project-atlas. */
export const PKG = fileURLToPath(new URL('..', import.meta.url))

/** Временные файлы тестов — в `temp/` пакета (он в .gitignore), не вне репозитория. */
export const TEMP = join(PKG, 'temp')

/** Синтетический проект — docs/input-spec.md, приложение B. */
export const FIXTURE = join(PKG, 'test/fixtures/minimal')

/** Английский близнец минимальной фикстуры: тот же граф на словаре `en`. */
export const FIXTURE_EN = join(PKG, 'test/fixtures/minimal-en')

/** Конфигурация примера ai-advent-2026: её проверяет тест совместимости. */
export const EXAMPLE_CONFIG = join(PKG, 'examples/ai-advent-2026/atlas.config.json')

/**
 * Копия фикстуры во временном корне: тесты ломают входы и подкладывают
 * секреты, не трогая саму фикстуру. Возвращает корень, путь к конфигурации и
 * функцию уборки.
 * @param {string} from какую фикстуру копировать; по умолчанию — русская
 */
export function copyFixture(from = FIXTURE) {
  mkdirSync(TEMP, { recursive: true })
  const root = mkdtempSync(join(TEMP, 'fixture-'))
  cpSync(from, root, { recursive: true })
  return { root, config: join(root, 'atlas.config.json'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Правка конфигурации копии: `change` получает разобранный JSON и меняет его на месте. */
export function editConfig(root, change) {
  const file = join(root, 'atlas.config.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  change(config)
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Синтетический деплой: две единицы (`app1`, `app2`), шлюз, прокси `web`,
 * статика `public`, три тома. Текст свой, ни строки из реальных проектов.
 */
export const DEPLOY = {
  compose: `services:
  app1:
    image: registry.invalid/team/app1:latest
    env_file:
      - ./app1.env
    depends_on:
      - gateway
    volumes:
      - app1_data:/data
  app2:
    image: registry.invalid/team/app2:latest
    depends_on:
      - gateway
  gateway:
    image: registry.invalid/team/gateway:latest
    volumes:
      - gateway_data:/data
  web:
    image: proxy:2
    depends_on:
      - app1
      - app2
    volumes:
      - ../public:/srv:ro
      - web_data:/data

volumes:
  app1_data:
  gateway_data:
  web_data: {}
`,
  caddy: `example.invalid {
\t# handle_path /old/* — пример в пояснении, а не маршрут
\thandle_path /app1/* {
\t\treverse_proxy app1:8080
\t}

\thandle_path /app2/* {
\t\treverse_proxy app2:8080
\t}

\thandle_path /gw/* {
\t\treverse_proxy gateway:9000
\t}

\t# --- статика ---
\thandle {
\t\troot * /srv
\t\tfile_server
\t}
}
`,
  landing: `<ul>
<li><a class="app" href="/app1/" data-date="01.02"><span class="app-text">Первое приложение</span></a></li>
<li><a class="app" href="/app2/" data-date="02.02"><span class="app-text">Второе приложение</span></a></li>
<li><a class="app" href="/atlas/"><span class="app-text">Атлас</span></a></li>
</ul>
`,
  providers: [{ id: 'model-x', kind: 'llm', tier: 'fast', model: 'x-small', baseUrl: 'http://gateway.invalid:4000' }],
}

/** Кладёт синтетический деплой в копию фикстуры и дописывает конфигурацию и overlay. */
export function addDeploy(root) {
  for (const dir of ['deploy', 'public', 'gateway', 'apps/app1', 'apps/app2', 'apps/notes']) mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'deploy/compose.yml'), DEPLOY.compose)
  writeFileSync(join(root, 'deploy/Caddyfile'), DEPLOY.caddy)
  writeFileSync(join(root, 'public/index.html'), DEPLOY.landing)
  writeFileSync(join(root, 'gateway/providers.json'), `${JSON.stringify(DEPLOY.providers, null, 2)}\n`)
  // Запись о втором приложении: связь «документ → единица» по имени файла.
  writeFileSync(
    join(root, 'docs/history/2026-01-20-0900-app2-launch.md'),
    '# Запуск второго приложения\n\n## Что сделано\n\nВторое приложение открыто по ADR `2026-01-15-1000`.\n',
  )
  editConfig(root, (c) => {
    c.units = { dir: 'apps', prefix: 'app' }
    c.deploy = {
      compose: 'deploy/compose.yml',
      proxy: 'web',
      caddyfile: 'deploy/Caddyfile',
      landing: 'public/index.html',
      static: [{ name: 'public', dir: 'public', file: 'public/index.html', note: 'Статика, которую web отдаёт из bind-монтирования ../public.' }],
      registry: { prefix: 'registry.invalid/', external: 'registry' },
      providers: { file: 'gateway/providers.json', service: 'gateway' },
    }
  })
  const overlayFile = join(root, 'atlas.overlay.json')
  const overlay = JSON.parse(readFileSync(overlayFile, 'utf8'))
  overlay.externals = [
    { id: 'registry', title: 'Реестр образов', kind: 'registry', note: 'Образы единиц; сервер только тянет тег.' },
    { id: 'ci', title: 'Сборка', kind: 'ci', note: 'Собирает и публикует образы.' },
    { id: 'model-api', title: 'Внешняя модель', kind: 'llm', note: 'Первое приложение ходит в неё напрямую.' },
  ]
  overlay.publishes = [{ from: 'ci', to: 'registry' }]
  overlay.calls = [{ from: 'app1', to: 'model-api' }]
  writeFileSync(overlayFile, `${JSON.stringify(overlay, null, 2)}\n`)
}

/**
 * Заполненность раскладки — одно определение на все тесты и отчёты. Три
 * независимых замера этапа 3 разошлись (162, 148 и 172 узла из 176) ровно
 * потому, что нормировали сетку по-разному; спорить было не о чем, но
 * повторить друг друга не вышло. Поэтому определение записано словами:
 *
 * - **Считаются все узлы графа**, включая изолированные: их место в картинке
 *   такое же, как у прочих, и прятать их из метрики нельзя.
 * - **Сетка нормируется по полю**, а не по габариту узлов: ячейка — это
 *   `1/cells` единичного квадрата `0…1`, начало координат в `(0, 0)`, размер
 *   поля всегда 1×1 независимо от того, где легли крайние узлы. Нормировка по
 *   габариту растягивала бы сетку вслед за выбросом — то есть мерила бы не
 *   то же самое от сборки к сборке.
 * - **Номер ячейки** — `Math.floor(координата × cells)`, значение `1.0`
 *   относится к последней ячейке (`cells - 1`), а не к несуществующей
 *   `cells`.
 * - **`filled`** — доля узлов, попавших каждый в свою ячейку: число занятых
 *   ячеек, делённое на число узлов (или на число ячеек, если узлов больше).
 *   Доля именно от узлов: порог должен ловить слипание, а не зависеть от
 *   того, сколько документов в проекте.
 * - **`median`** — медиана расстояния от узла до ближайшего соседа в тех же
 *   единицах `0…1`; при чётном числе узлов берётся верхний из двух средних.
 *
 * @param {Array<{x:number, y:number}>} points все узлы раскладки
 * @param {number} cells сторона сетки в ячейках
 */
export function density(points, cells = 20) {
  const cell = (v) => Math.min(cells - 1, Math.floor(v * cells))
  const busy = new Set()
  for (const p of points) busy.add(`${cell(p.x)},${cell(p.y)}`)

  const nearest = points
    .map((a) => Math.min(...points.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
    .sort((a, b) => a - b)

  return {
    busy: busy.size,
    filled: busy.size / Math.min(points.length, cells * cells),
    median: nearest[Math.floor(nearest.length / 2)],
  }
}
