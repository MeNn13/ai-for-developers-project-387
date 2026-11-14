# Издатель реализации через GitHub App

Издатель из #40 принимает подготовленные данные без модели реализации. Workflow
[implementation-publish.yml](../.github/workflows/implementation-publish.yml) запускает
только код точного `github.sha` основной ветки. Артефакты никогда не исполняются,
checkout результата, shell-команды из результата и Git push отсутствуют.
Репозиторий задан константой; ветка вычисляется только как `spec/<номер спецификации>`.

## Настройка человеком

1. Зарегистрировать отдельное GitHub App и установить его **только** в
   `MeNn13/ai-for-developers-project-387`. Разрешения: Contents и Pull requests —
   write, Issues и Actions — read; Metadata — обязательное read. Workflows,
   Administration и OIDC не нужны. Не использовать App триажа или ключ модели.
2. Создать environment `implementation-publisher`, разрешить deployment только
   из `main`, добавить required reviewer человека. Его секрет
   `PUBLISH_APP_PRIVATE_KEY` содержит PEM-ключ App; в переменных environment
   задать `PUBLISH_APP_ID`, `PUBLISH_INSTALLATION_ID`, `PUBLISH_APP_BOT_ID`.
   Последнее — числовой **user ID bot**, а не App ID или installation ID.
   Ключ не хранить в общих repository secrets, доступных заданию модели.
3. Авторевью из #39 явно допускает эту же идентичность через `REVIEW_APP_LOGIN`
   и `REVIEW_APP_ID`. Login берётся у App bot, ID равен `PUBLISH_APP_BOT_ID`.
   Не расширять допуск на всех Bot.
4. После merge доверенного производителя #41 подготовить реальный результат,
   выполнить workflow издателя с `source_run`, проверить созданный draft PR,
   CI и авторевью на его точном SHA. Следующим проверенным результатом обновить
   тот же PR. Сохранить ссылки на Actions и PR как свидетельства приёмки.
5. Человек включает обязательный успешный CI основной ветки и разрешение Actions
   создавать PR для release-please. Если тариф не позволяет защиту, перед merge
   вручную сверяет текущий head со статусами и браузерным артефактом.

[Installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
ограничен одним репозиторием и перечисленными правами. Скрипт маскирует токен и
передаёт его только процессу издателя в том же job; ключ не передаётся дальше.
Установка App и наличие YAML сами по себе не доказывают работающий CI.

## Контракт подготовленного результата

Доверенный producer — `.github/workflows/opencode-implement.yml`, запущенный из
`main` того же репозитория, с `head_sha`, равным доверенному SHA издателя.
Обязательны успешные jobs `implementation-context` и `implementation-check`.
При неполном списке jobs издатель останавливается. Полученные артефакты лежат
в отдельных каталогах, поэтому результат не подменяет контекст или проверку.

Producer публикует три артефакта с единственным JSON в каждом:

| Артефакт                      | Файл                | Кто формирует                          |
| ----------------------------- | ------------------- | -------------------------------------- |
| `implementation-context`      | `context.json`      | Доверенная подготовка до модели        |
| `implementation-result`       | `result.json`       | Подготовка результата без секретов App |
| `implementation-verification` | `verification.json` | Доверенное задание проверки            |

`context.json` версии 1 содержит `runId`, `trustedSha`, `base` (равен trustedSha),
`expectedHead` (base для новой ветки), `commitDate` (UTC `YYYY-MM-DDTHH:mm:ssZ`),
числа `source`, `spec`, массив `tickets`, `approval` (ID согласующего комментария),
его точный `approvalBody` и `snapshots: [{number, body}]` для исходного обращения,
спецификации и каждого тикета. Body снимка равен описанию issue: издатель заново
сверяет его с GitHub и отклоняет изменение требований. Издатель получает комментарий,
проверяет allowlist человека, association, исходное issue и неизменность текста.
Семантическую полноту согласования проверяет producer до создания контекста.

`result.json` версии 1 содержит `contextDigest`, `candidateSha`, `ready`,
`message`, `files: [{path, mode, content}]`, `risk`, `rollback`.
Digest — SHA-256 UTF-8 `JSON.stringify` распарсенного объекта (без pretty print).
`mode` всегда `100644`; `content: null` удаляет файл. Переименование представляется
удалением и добавлением: оба пути проходят один фильтр. Неподдерживаемые пути,
symlink, обходы через `..`, обратные слеши, percent encoding и дубли путей
отклоняются до записи. Лимит — 200 файлов и 2 MB результата.

Разрешены только C# приложения/тестов backend, TS/TSX/CSS в `frontend/src`,
`e2e/*.spec.ts`, `contract/main.tsp` и OpenAPI. Workflow, скиллы, инструкции,
критерии ревью, scripts, конфиги проверок, зависимости и генератор исключены.
Изменение этой инфраструктуры готовится отдельным человеческим PR.
Generated-файлы producer получает только через `mise run generate`.

Издатель создаёт один коммит на результат с единственным родителем expectedHead,
author/committer `Implementation Publisher <implementation-publisher@users.noreply.github.com>`,
датой `context.commitDate` и сообщением `result.message`. Producer должен собрать
**тот же** коммит, выполнить `mise run check` на его точном SHA и записать
`verification.json`: `version: 1`, `runId`, `resultDigest`, `sha`,
`command: "mise run check"`, `conclusion: "success"`, `ready`.
`sha` равен `candidateSha`; digest связывает проверку со всеми файлами и метаданными.
Готовность требует завершённого графа и общего Standards + Spec review.
Результат модели не имеет права создавать или заменять verification/context.
Изоляция producer и сохранение свидетельств — обязанность #41; до её настройки
ручной издатель не принимает произвольные локальные JSON или чужой Actions run.

## Публикация и восстановление

Вызвать **Actions → implementation-publish → Run workflow** из main. `source_run`
указывает успешный producer run. Для обновления или восстановления передать
`previous_run` — run издателя с последним `implementation-publication`.
Его receipt проверяется по происхождению Actions, App bot, branch и head.
Имя ветки или комментарий-маркер сами по себе прав записи не предоставляют.

Перед изменением ref head читается повторно; обновление использует
[`force: false`](https://docs.github.com/en/rest/git/refs#update-a-reference).
Чужое обновление останавливает публикацию. PR создаётся draft, содержит источники,
согласование, закрывающие ссылки, проверки и SHA, риск и откат. `ready` переводит
его в review только при совпадении независимого verification. Новая команда
исправления создаёт новый коммит; опубликованная история не переписывается.
Сообщение проверяется как ASCII Conventional Commit со ссылкой на свой тикет;
императивный английский смысл дополнительно проверяет человек.

Receipt сохраняется сразу после ref и после PR даже при ошибке следующего шага.
Повтор того же digest с доверенным receipt достраивает PR без нового коммита.
Если ответ ref потерян или job отменён до сохранения receipt, результат может
быть опубликован частично: требуется ручная сверка Actions, ветки и PR. Издатель
не присваивает найденную ветку и не выполняет force/reset для восстановления.
Объекты tree/commit, созданные до отказа ref, могут остаться недостижимыми.
`state: possible`/`unknown` в диагностике не означает отсутствия записи.
Удаление истории Actions или истечение семидневного receipt блокирует
автоматическое продолжение; права вручную не расширяются.

Пока #41 не подключил общий бюджет и свежий допуск для каждого publisher Re-run,
workflow остаётся ручной границей с environment approval, а не автоматическим
циклом реализации. Он не заявляет соблюдение трёх попыток и завершение #38.

## Проверки и ограничения

`mise run test:scripts` проверяет API-операции на фикстурах: draft, обновление,
готовность, чужую ветку, происхождение, проверку точного SHA, устаревший head,
защищённые пути и частичное восстановление. `mise run lint:ci` проверяет workflow.
Они не подтверждают установку App, доступность секретов, реальную подпись коммита,
запуск CI/авторевью или GitHub environment protection. Живая проверка из шага 4
остаётся невыполненной до настройки человеком. Полный `mise run check` обязателен
перед push инфраструктуры.
