# AGENTS.md

## Проект

Сервис бронирования календаря: один владелец, гости без регистрации, данные в памяти.
Часовой пояс — `Europe/Moscow`, рабочее время — Пн–Пт 10:00–18:00, окно записи — 14 дней.
Полный пользовательский сценарий — в `README.md`.

- Backend: ASP.NET Core 10, Minimal API.
- Frontend: React 19, TypeScript, Vite 8, Mantine 9.
- Контракт: TypeSpec → OpenAPI 3.0 → TypeScript-клиент (Orval) и серверные C# DTO.

## Команды

- `mise trust` — разрешить конфигурацию mise.
- `mise install` — установить версии инструментов из `mise.toml`.
- `mise run install` — восстановить зависимости .NET и npm.
- `mise run dev` — запустить API на `:5000` и Vite на `:5173`.
- `mise run check` — все проверки: линтеры, секреты, типы, тесты, сборка, сверка
  сгенерированных файлов. Обязательна перед пушем, CI вызывает её же.
- `mise run check:audit` — проверки с сетью и по всей истории git (CI и вручную).
- `mise run fix` — безопасные автоисправления (Prettier, `dotnet format`).
- `mise run test` — тесты backend.
- `mise run test:web` — тесты frontend.
- `mise run lint` — линтеры.
- `mise run build` — production-сборка backend и frontend.
- `mise run generate` — OpenAPI, клиент и серверные DTO из TypeSpec.
- `mise run generate:check` — проверка актуальности всех артефактов без их изменения.
- `mise run docker:build` / `docker:run` — образ и контейнер локально.
- `mise run docker:check` — собрать образ, запустить контейнер, проверить ответы
  (медленно, поэтому только CI и вручную).
- `mise run hooks:install` — установить git-хуки.
- `mise daemons status` / `logs` / `stop` — состояние и остановка dev-серверов.

## Структура

- `backend/` — ASP.NET Core API и xUnit-тесты.
- `contract/` — TypeSpec, `contract/openapi/openapi.yaml`, конфигурация Orval.
- `contract/server/` — изолированный emitter и проектный патч; результат в
  `backend/BookingCalendar.Api/Generated`.
- `frontend/` — React/Vite/Mantine; сгенерированный клиент в `src/api/generated`.
- `mise.toml` — версии и задачи, `hk.pkl` — git-хуки, `.github/workflows/ci.yml` — CI.
- `Dockerfile` — один образ: API и собранный фронтенд в `wwwroot`; `scripts/image-check.mjs`
  проверяет, что образ собирается и контейнер отвечает.
- Конфиги проверок: `knip.json`, `lychee.toml`, `.rumdl.toml`, `.agnix.toml`,
  `.prettierrc.json`, `commitlint.config.js` в корне; `.github/jactionlint.yaml`,
  `.github/dependabot.yml`.

## Правила

- `contract/main.tsp` — источник истины для API. После изменения контракта запустить
  `mise run generate` и коммитить OpenAPI, клиент и серверные DTO вместе.
- `frontend/src/api/generated`, `contract/openapi` и
  `backend/BookingCalendar.Api/Generated` целиком принадлежат генераторам;
  ручное редактирование, включая generated C#, запрещено. `mise run check`
  сначала сравнивает их со свежей генерацией в `artifacts/`, включая лишние файлы,
  и падает на расхождении без исправления. Для восстановления — `mise run generate`.
- При обновлении emitter или патча читать `contract/server/README.md` и ADR-0003.
  Generated DTO используются только в API; Domain и Application от них независимы.
- Правила линтеров не отключаются ради зелёной сборки. Исключение — узкое (путь и
  правило), с причиной и датой ревью (например, `expires` в `.github/jactionlint.yaml`),
  и это решение человека, а не агента.
- `.github/workflows/hexlet-check.yml` не удалять и не переименовывать.
- В PR от Dependabot `hexlet-check` падает без секрета `HEXLET_ID` — это
  ожидаемо; гейтом служит workflow `ci`.
- `@types/node` держится на мажоре Node из `mise.toml`: мажорные обновления типов
  приходят только вместе с обновлением Node, иначе компилятор пропускает вызовы,
  которых нет в рантайме.
- Данные хранятся в памяти: после перезапуска API типы встреч и записи сбрасываются.
  Внешней БД нет.
- Авторизации нет, страница владельца не защищена паролем.
- Бронирование атомарно: пересекающиеся интервалы запрещены, при одновременных запросах
  успешен только один.
- Unit-тесты — только чистая арифметика времени в `SlotRules`: сетка, рабочие часы,
  граница 18:00, окно записи, `start > now`, пересечения. Новый краевой случай из спеки
  падает сюда, а не в интеграционные тесты.
- Всё наблюдаемое поведение проверяется через HTTP на общем `TestApp` с подменой времени
  через `FakeTimeProvider`; данные готовятся только публичным HTTP, сиды в обход него
  запрещены. Приватные методы и устройство хранилища не тестируются.
- Frontend-тесты мокают сгенерированный клиент на границе модуля (`vi.mock`) — без MSW
  и ручных стабов `fetch`; тесты страниц лежат рядом со страницами, запросы — по роли
  и метке, снапшоты запрещены.
- Сквозной браузерный E2E — Playwright/Chromium в `e2e/`: собранный React и отдельный
  настоящий локальный API, данные только через интерфейс браузера, без моков и сидов.
  `mise run test:e2e` собирает приложение и запускает проверку; она входит в `check`.
  `test:web` — Vitest с моком клиента, `docker:check` — смоук образа.
  Численного порога покрытия нет: минимум один тест
  на каждый поведенческий пункт спеки, это проверяется на ревью.
- `mise run check` должен быть зелёным до пуша. CI вызывает ту же команду.
- Pre-push хук запускает `mise run check` в текущем чекауте: пушить ветку из её
  чекаута или worktree — из чужого чекаута хук проверит не ту ветку.
- Падение сборки или `generate:check` с пустым либо исчезающим при повторе diff —
  синхронизация OneDrive: перезапустить команду, код не менять.
- Для git-хуков `mise` должен быть доступен в `PATH` (в PowerShell — через `mise activate pwsh`).

## Коммиты

Формат — Conventional Commits: `<type>(<scope>): <subject>`.
Сообщения коммитов на английском, документация на русском.

- `type`: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`, `perf`,
  `revert`, `style`.
- `scope` необязателен: `api`, `web`, `contract`, `ci`, `docs`.
- `subject`: английский, повелительное наклонение, строчная буква, без точки в конце,
  до 72 символов.
- `body` по желанию, объясняет причину изменения; на английском.
- Breaking change: `!` перед двоеточием и/или футер `BREAKING CHANGE: ...`.
- Один коммит — одно логическое изменение.
- Релизы собирает release-please: при push в `main` он открывает и обновляет релизный PR
  из Conventional Commits; конфиг — `release-please-config.json` и
  `.release-please-manifest.json` в корне, workflow — `.github/workflows/release-please.yml`.
  В настройках репозитория (Settings → Actions → Workflow permissions) должно быть
  разрешено создание PR действиями, иначе workflow падает с «not permitted to create
  pull requests».
- Коммит реализации ссылается на тикет, который он закрывает, например `feat: запись на свободный слот (#12)`. GitHub превращает номер в ссылку, и по истории видно, какой коммит какую задачу делал

Примеры:

```text
feat(api): add meeting type creation
fix(booking): reject overlapping slots
chore(ci): run checks on push
docs: describe local setup
```

## Agent skills

При работе в Windows, ошибках PATH/кодировки или публикации рабочей ветки
читать `docs/agents/windows.md`.

### Issue tracker

Задачи и спецификации живут в GitHub Issues репозитория
`MeNn13/ai-for-developers-project-386`, работа — через CLI `gh`. См.
`docs/agents/issue-tracker.md`.

### Triage labels

Пять канонических ролей триажа используют строки меток по умолчанию, без
переименований. См. `docs/agents/triage-labels.md`.

### Domain docs

Один контекст: `GLOSSARY.md` и `docs/adr/` в корне репозитория. См.
`docs/agents/domain.md`.
