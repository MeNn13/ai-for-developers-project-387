# Календарь звонков (продолжение)

[![hexlet-check](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/MeNn13/ai-for-developers-project-387/actions)

Интегрируйте работу агентов в GitHub проект

Учебный проект Хекслета: <https://ru.hexlet.io/programs/ai-for-developers>
Как это должно работать: <https://files.hexlet.app/a/2ipc5m>

Приложение перенесено из [первого проекта](https://github.com/MeNn13/ai-for-developers-project-386).
Исходные [спецификация #23](https://github.com/MeNn13/ai-for-developers-project-386/issues/23)
и [карта решений #14](https://github.com/MeNn13/ai-for-developers-project-386/issues/14)
остаются в старом трекере. Все новые задачи, спецификации и решения ведутся в
[трекере этого проекта](https://github.com/MeNn13/ai-for-developers-project-387/issues).
Сохранены [словарь](GLOSSARY.md), [ADR](docs/adr/) и [история изменений](CHANGELOG.md)
со ссылками на исходные решения.

## Приложение

Сервис бронирования календаря одного владельца. Гости бронируют встречи без
регистрации. Backend — ASP.NET Core 10 Minimal API; frontend — React 19,
TypeScript, Vite 8 и Mantine 9. Контракт API задаётся в TypeSpec.

### Пользовательский сценарий

1. Владелец открывает страницу /owner и создаёт тип встречи: название, описание
   и длительность.
2. Гость с главной страницы переходит к бронированию /book, выбирает тип встречи
   и свободный слот, указывает имя и подтверждает бронирование.
3. Гость видит подтверждение, владелец — предстоящую встречу в списке.

Время — Europe/Moscow, рабочие часы — Пн–Пт 10:00–18:00, окно записи — 14 дней.
Начала слотов идут каждые 30 минут; встреча должна полностью помещаться в рабочие
часы и начинаться в будущем. Пересекающиеся встречи запрещены для всех типов:
при одновременном бронировании одного интервала успешен только один запрос.

Данные хранятся в памяти и сбрасываются при перезапуске API. Авторизации нет:
страница владельца открыта всем. Термины описаны в [словаре](GLOSSARY.md).

## Установка

Установите Git и [mise](https://mise.jdx.dev/getting-started.html), затем выполните:

```bash
git clone https://github.com/MeNn13/ai-for-developers-project-387.git
cd ai-for-developers-project-387
mise trust
mise install
mise run install
```

Для локального запуска база данных, секреты и переменные окружения не нужны.
При первом запуске браузерных тестов установите Chromium: `mise exec -- npx playwright install chromium`.

## Запуск и проверки

```bash
mise run dev
```

- Frontend: <http://127.0.0.1:5173>.
- API: <http://127.0.0.1:5000/api/health>.

```bash
mise run check
```

Полная локальная проверка обязательна перед пушем; CI вызывает ту же команду.
Автоисправления — `mise run fix`. Подробности проверок и управления фоновыми
процессами — в [руководстве разработчика](docs/development.md).

## GitHub-агент

OpenCode запускается в GitHub Actions. Основная модель —
`opencode/deepseek-v4.1-flash-free`. Независимое ревью и аудит при временной ошибке
провайдера могут использовать GPT-OSS 20B через Cloudflare Workers AI. Ключ модели
хранится в GitHub Secrets (`OPENCODE_API_KEY`). Ответы публикует GitHub Actions,
ветку и PR с реализацией публикует GitHub App `menn13-calendar-publisher` после
ручного одобрения издателя.

| Воркфлоу                                                                                                                                                                                                                                     | Когда запускается                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [opencode](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/opencode.yml)                                                                                                                                           | При открытии issue разбирает обращение. При создании общего или построчного комментария обрабатывает команды доверенного участника.                                    |
| [opencode-implement](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/opencode-implement.yml)                                                                                                                       | По команде `implement-spec` из исходного issue после согласования спецификации и тикетов.                                                                              |
| [independent-review](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/opencode-review.yml) и [browser-acceptance](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/browser-acceptance.yml) | При открытии или обновлении PR и переводе из Draft. Ревью получает [критерии календаря](REVIEW.md), браузерный прогон сохраняет Playwright trace для точного head SHA. |
| [implementation-completion](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/implementation-completion.yml)                                                                                                         | Периодически и вручную. Сообщает причину завершения исправления, последний известный SHA и ссылку на запуск.                                                           |
| [Lighthouse audit](https://github.com/MeNn13/ai-for-developers-project-387/actions/workflows/lighthouse-audit.yml)                                                                                                                           | Вручную из `main` в режиме `training` или `live`. Ежедневный `live` в 06:17 МСК требует настройки `APP_URL` и `AUDIT_STATUS_ISSUE`.                                    |

Команда начинается с `/oc` или `/opencode`. Используйте новый комментарий:

```text
/oc разбери это обращение
/oc примени скилл to-spec по этому обсуждению
/oc примени скилл to-tickets к спецификации #74
/oc implement-spec spec=#74 tickets=#75 approve
/oc fix <publisher-run-id> <описание исправления>
```

Перед `implement-spec` владелец согласовывает спецификацию и список тикетов.
`/oc fix` работает в общем комментарии и на строке diff. `publisher-run-id`
берётся из `implementation-publication` для текущего head PR. Лимит — три
допущенные попытки на PR. Ссылки на запуски и артефакты доступны на вкладке
**Actions** и в обсуждении PR. Настройка и диагностика описаны в
[руководстве по GitHub-агенту](docs/github-agent.md).

### Демонстрационный цикл

- [Обращение #73](https://github.com/MeNn13/ai-for-developers-project-387/issues/73)
  прошло автотриаж, затем агент подготовил
  [спецификацию #74](https://github.com/MeNn13/ai-for-developers-project-387/issues/74)
  и [тикет #75](https://github.com/MeNn13/ai-for-developers-project-387/issues/75).
  Владелец [согласовал реализацию](https://github.com/MeNn13/ai-for-developers-project-387/issues/73#issuecomment-7165953036).
- App открыл [PR #76](https://github.com/MeNn13/ai-for-developers-project-387/pull/76).
  После [общего комментария](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#issuecomment-7168288231)
  агент усилил проверку видимости кнопки на 360×640, а после
  [комментария к строке](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#discussion_r4698245117)
  добавил тест восстановления после ошибки загрузки типов встреч.
- На итоговом SHA `ca1a9ebb734af2719200b8db6a0d9530ec464453` прошёл
  [CI](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45664637776),
  опубликовано [независимое ревью](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#issuecomment-7169677996)
  и сохранён [браузерный артефакт](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45664638091/artifacts/15046108332).
  В PR остались [личная браузерная приёмка](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#issuecomment-7170091063),
  [разбор замечаний](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#issuecomment-7170290193)
  и [логи падения и успешного прогона теста](https://github.com/MeNn13/ai-for-developers-project-387/pull/76#issuecomment-7170246222).
  Решение о мерже принял владелец. После мержа прошли
  [CI на `main`](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45672144159)
  и [автопроверка Хекслета](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45672144269).
- [Первый учебный аудит](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45672382163)
  сохранил `lighthouse-report` и `lighthouse-analysis` и создал
  [задачу #78](https://github.com/MeNn13/ai-for-developers-project-387/issues/78)
  по синтетической находке. [Повторный запуск](https://github.com/MeNn13/ai-for-developers-project-387/actions/runs/45672741372)
  завершился успешно, в Issues осталась одна задача по этой находке.

### Личные выводы о работе GitHub-агента

Мне полезны автотриаж и независимое ревью в GitHub. В #73 агент сформулировал
уточнения до реализации, и я зафиксировал решения в той же задаче. В #76
замечание о длинной надписи привело к конкретной проверке на 360×640, а запись
Playwright позволила мне увидеть результат на итоговом коммите перед мержем.

Для разработки я всё ещё предпочитаю локального агента. Больше всего времени в
этом цикле заняли настройки прав и диагностика. Общий и построчный комментарии
вызывали один сценарий исправления, но GitHub по-разному проверял доступ к
окружению издателя. Для построчной правки пришлось настроить правило для PR и
отдельно одобрить публикацию. Повторное авторевью после перевода PR из Draft
упёрлось в лимит контекста 300 КБ. Для решения о мерже я использовал уже
опубликованное ревью того же SHA и завершившиеся проверки.

Аудит по расписанию я бы оставил. В учебном режиме агент сохранил исходный отчёт
и создал задачу, а повторный запуск показал, что одна находка не засоряет трекер
дублями. Для рабочего аудита мне важно видеть ссылку на измерение рядом с
каждой рекомендацией.

## Документация

| Задача                                                   | Где читать                               |
| -------------------------------------------------------- | ---------------------------------------- |
| Разработка, проверки, Makefile и генерация               | [Разработка](docs/development.md)        |
| Docker, хостинг, MCP и история приёмки                   | [Деплой](docs/deployment.md)             |
| Вызов GitHub-агента, реализация, авторевью и диагностика | [GitHub-агент](docs/github-agent.md)     |
| Правила изменения кода и тестирования                    | [AGENTS.md](AGENTS.md)                   |
| Контракт API и сгенерированные файлы                     | [Контракт](contract/README.md)           |
| Термины и архитектурные решения                          | [Словарь](GLOSSARY.md), [ADR](docs/adr/) |

## Автоматические тесты Хекслета

Тесты запускаются на каждый коммит. За запуск отвечает файл
`.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его,
ни репозиторий.

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.
