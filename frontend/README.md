# Фронтенд

React + TypeScript + Vite. UI-компоненты — Mantine.

## Команды

Из корня репозитория:

```bash
mise run dev        # запуск API и Vite
mise run check      # линтеры, типы и тесты
mise run generate   # TypeSpec → OpenAPI → клиент
```

Только фронтенд:

```bash
npm run dev --workspace frontend
npm run build --workspace frontend
npm run lint --workspace frontend
npm run typecheck --workspace frontend
```

Сгенерированный клиент лежит в `src/api/generated` и вручную не редактируется.
