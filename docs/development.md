# Разработка и проверки

[Обзор и быстрый старт](../README.md).

## Стек

- Backend: .NET 10 (LTS), ASP.NET Core Minimal API.
- Frontend: React 19, TypeScript, Vite 8, Mantine 9.
- Контракт: TypeSpec 1.17 → OpenAPI 3.0 → TypeScript-клиент (Orval) и серверные C# DTO.
- Тесты: xUnit + `WebApplicationFactory` на бэкенде, Vitest + Testing Library на
  фронтенде.
- Окружение: mise, hk, pitchfork.

Версии инструментов зафиксированы в `mise.toml` и `mise.lock`, зависимости — в lock-файлах npm и NuGet.

## Фоновые процессы

```bash
mise daemons status
mise daemons logs api -n 50
mise daemons stop
```

## Проверки

```bash
mise run check
```

Одна команда запускает всё, что можно проверить локально: линтеры (анализаторы
.NET и `dotnet format`, TypeSpec, Oxlint, Prettier, rumdl, jactionlint, agnix,
knip, syncpack, vacuum), поиск секретов, проверку типов, тесты, сборку и сверку
сгенерированных файлов с контрактом. CI вызывает эту же команду. Правила
тестирования — где unit, где HTTP, где моки — в [AGENTS.md](../AGENTS.md#правила).

Ещё в CI есть отдельная задача `audit`:

- `mise run check:audit` — проверки, которым нужна сеть или вся история git:
  уязвимости в lock-файлах (OSV-Scanner), секреты в истории (betterleaks),
  битые ссылки (lychee). Запускается на каждый PR и раз в неделю по расписанию.
- Сообщения коммитов (`commitlint`) и совместимость OpenAPI с базовой веткой
  (`oasdiff`) проверяются прямо в workflow: им нужен диапазон коммитов.

Быстрые проверки изменённых файлов запускаются в `pre-commit`, полный
`mise run check` — в `pre-push`. Автоисправления: `mise run fix`.

Те же задачи доступны через корневой `Makefile`: `make install`, `make dev`,
`make check`, `make lint`, `make test`, `make test-web`, `make build`,
`make generate` и `make fix`. Makefile вызывает задачи mise, поэтому логика
проверок остаётся общей с CI. Нужен GNU Make; на Windows, если `make` не
установлен, используйте команды `mise run` напрямую.

## Генерация контракта

Генерация OpenAPI, клиента и серверных транспортных моделей:

```bash
mise run generate
```

Источник истины и выходные каталоги описаны в [контракте](../contract/README.md).
При изменении emitter или патча читать [инструкцию генератора](../contract/server/README.md)
и [ADR-0003](adr/0003-generated-server-models.md).
