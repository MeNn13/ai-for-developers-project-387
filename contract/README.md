# Контракт API

Источник истины для API — TypeSpec. Из него генерируются OpenAPI, TypeScript-клиент
и серверные C# DTO для HTTP-слоя Minimal API.

```bash
mise run generate
```

Результат:

- `openapi/openapi.yaml` — OpenAPI 3.0;
- `../frontend/src/api/generated/booking.ts` — клиент для фронтенда.
- `../backend/BookingCalendar.Api/Generated` — серверные модели и helpers.

Сгенерированные файлы вручную не редактируются: меняйте `main.tsp` и запускайте генерацию.
`mise run generate:check` проверяет полное содержимое выходных каталогов без
изменений. Зависимости серверного emitter изолированы в `server/` и устанавливаются
общим `mise run install`. Версии, проектный патч и его обновление — в
[инструкции генератора](server/README.md).
