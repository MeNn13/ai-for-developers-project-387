# Проверка серверных моделей TypeSpec (#52)

## Продолжение: #56, экспериментальный патч emitter

**Непатченный официальный alpha.32 по-прежнему несовместим со строгой сборкой.
С локальным воспроизводимым исправлением самого emitter сборка net10.0 и
проверка wire-формата проходят.** Сгенерированный C# не исправляется вручную,
production и правила проверок не меняются. Это результат кастомизированного
генератора, а не нового официального релиза.

### Диагностика и красный/зелёный прогоны

На чистой main команда `dotnet run` существующего probe воспроизвела CS8618
в generated свойствах. Проверены гипотезы о настройках, обработке обязательности
и влиянии helpers. В установленном alpha.32 `lib.js` не содержит настройки
required/nullable. `components/models/models.js`, функция `ServerProperty`,
явно следует старому выводу без required и nullable для ссылочных типов.
По анализу generated-кода причина видна на обязательном string-свойстве
без инициализатора. Отдельный минимальный reproducer не запускался: проверка
выполнена на полном текущем контракте, исключение MVC-фильтра не устранило CS8618.

Справка [официальных опций](https://typespec.io/docs/emitters/servers/http-server-csharp/reference/emitter/)
и исходники установленного npm-пакета сверены. Новые релизы повторно не
перебирались: зависимости уже исследованы в #54.

`patch-emitter.mjs` явно запускается отдельно и исправляет **источник emitter**:

- обязательные свойства без инициализатора получают `required`;
- необязательные свойства получают nullable, включая ссылочные;
- `plainDate` отображается в `DateOnly` вместо `DateTime`.

Патч привязан к alpha.32, проверяет точные участки исходника и поддерживает
повторный запуск. `npm ci` удаляет патч: установка по lock-файлу сама по себе
его не применяет. Патч не претендует на исправление всех возможных контрактов.

После первых двух исправлений сборка стала зелёной, сериализация выполнилась.
Probe с проверкой схем показал **12 несовместимостей**: даты со временем вместо
date, `errors:null` у обычных ошибок и HTTP-обёртки вместо тел 201, плюс отдельные
проверки дат/отсутствия errors. Исправление date в emitter, применение настроек
из production `Http/Problems.cs` и выбор `Body` вместо обёртки дали код **0**,
`Wire incompatibilities: 0`. Ни одна проверка не отключалась ради успеха:
обёртки дополнительно проверяются как отрицательные примеры.

### Команды из корня checkout

```powershell
mise exec -- npm ci --prefix docs/experiments/server-models --ignore-scripts
mise exec -- node docs/experiments/server-models/patch-emitter.mjs
mise exec -- node docs/experiments/server-models/generate.mjs
mise exec -- dotnet run --project docs/experiments/server-models/Probe.csproj
```

Версии TypeSpec/Alloy не изменены относительно #54, SDK net10.0 — из mise.
NuGet-зависимости probe закреплены в `packages.lock.json`: JsonSchema.Net 9.5.0,
YamlDotNet 18.1.0. Probe напрямую использует существующий `OpenApiContract.cs`
через Compile Link, без копии и без изменения production-тестов. JSON сохраняется
в игнорируемый `artifacts/wire.json`; код 1 означает несовместимость.

### Матрица фактически выполненных проверок

| Объект                        | Результат                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Meeting.id                    | UUID-строка: схема с проверкой format и Guid.TryParse проходят                                        |
| MeetingType.id, meetingTypeId | Строковые ID в непустых примерах проходят схемы                                                       |
| Meeting.start/end             | DateTimeOffset, формат date-time и смещение +03:00 сохранены                                          |
| MeetingCreateRequest          | Набор полей и сериализация start со смещением проверены; отдельная request JSON Schema не проверялась |
| SlotsResponse                 | Окно, 14 дней, date-only, вложенные слоты/available проходят схему с format validation                |
| HealthResponse                | status=ok проходит схему                                                                              |
| 200/201                       | Тела и непустые массивы MeetingType/Meeting проходят response-схемы                                   |
| 400/404/409                   | Все пять slug проверены по ProblemDetails и наличию кода в операции                                   |
| enum                          | Корректные slug проходят; неизвестный slug отклоняется схемой                                         |
| errors                        | Словарь массивов строк у validation-failed; у остальных поле отсутствует                              |
| body/statusCode               | Обёртки 201 отклоняются response-схемой, их Body проходит                                             |

Для обычных тел используются JsonSerializerDefaults.Web; для ProblemDetails —
такие же настройки плюс WhenWritingNull, как в production. Без этого errors:null
не соответствует текущей схеме. Сам emitter не ограничивает string type enum-ом
и не обеспечивает проверку входящих UUID: это не замена runtime-валидации API.

Существующий OpenApiContract раскрывает не все ссылки внутри anyOf в схемах
ошибочных ответов: первая попытка дала RefResolutionException. Поэтому ошибки
проверены непосредственно по компоненту ProblemDetails, а объявленные статусы —
отдельно. Проверка response anyOf целиком, десериализация запросов, HTTP-статусы
живого API с generated DTO, Linux и произвольные контракты не проверены.
Действующие production HTTP-тесты продолжают проверять приложение.

### Рекомендация

Практическая возможность строгой сборки и совместимой сериализации показана для
**кастомизированного** alpha.32. Следующее решение — поддерживать этот патч
генератора или выбрать другой способ генерации. При выборе патча требуется
отдельная задача интеграции: генерация и проверка актуальности в CI, отображение
тел HTTP-ответов и проверка живого API. До этого production DTO сохраняются.
Автоматическое обновление alpha.32 опасно: патч должен оставаться привязанным к
проверенному исходнику. Критерий урока об интеграции пока не объявляется выполненным.

## Продолжение: #54, 7 ноября 2026

Связанные задачи: [спецификация #49](https://github.com/MeNn13/ai-for-developers-project-386/issues/49),
[первый эксперимент #52](https://github.com/MeNn13/ai-for-developers-project-386/issues/52).
Разделы ниже сохраняют историю предыдущих экспериментов; актуальный результат — в разделе #56 выше.

**Конфликт Alloy устранён откатом emitter на `0.58.0-alpha.32`. Генерация успешна,
но совместимость с проектом не подтверждена: сборка неизменённых моделей на
net10.0 падает с CS8618. Сериализация не выполнена.** Production не изменён.

### Официальные источники и варианты

Помимо справки ниже проверены метаданные официальных опубликованных пакетов
через `npm view` (реестр npm, не предположения по наличию опции `models`):

- [alpha.32](https://www.npmjs.com/package/@typespec/http-server-csharp/v/0.58.0-alpha.32):
  Alloy core `^0.24.1`, csharp/msbuild `^0.24.0`, emitter-framework `^0.21.0`.
  Peer compiler/http/json-schema `^1.16.0` допускают текущие `1.17.0`;
  rest/versioning требуют `^0.86.0`, поэтому изолированно закреплены `0.86.0`.
- [alpha.33](https://www.npmjs.com/package/@typespec/http-server-csharp/v/0.58.0-alpha.33)
  остаётся `latest`: Alloy `^0.25.0` и framework `^0.21.0`. Исходный конфликт
  уже воспроизведён в #52; повторный запуск этой комбинации не требовался.
- [alpha.34-dev.2](https://www.npmjs.com/package/@typespec/http-server-csharp/v/0.58.0-alpha.34-dev.2)
  — `next`: разрешает framework `^0.21.0 || >= 0.22.0-dev.1`.
  С прямыми framework `0.22.0-dev.2`, canonicalization `0.16.5-dev.4`,
  Alloy core/csharp `0.25.0` установка успешна, но генерация с compiler `1.17.0`
  падает: `does not provide an export named 'resolveEncodedEnumMemberValue'`.
  При этом canonicalization всё ещё устанавливает вложенный framework `0.21.0`
  с Alloy `0.24.1`: прямое закрепление framework не согласует всю цепочку.
- Попытка nightly-набора: compiler `1.18.0-dev.15`, http `1.18.0-dev.6`,
  json-schema `1.18.0-dev.2`, openapi `1.18.0-dev.1`, rest `0.88.0-dev.0`,
  versioning `0.88.0-dev.2`, остальные next-версии выше и override framework
  на прямую зависимость. Установка **ERESOLVE**: canonicalization требует
  compiler `^1.16.0 || >= 1.17.0-dev.0`, не допускающий prerelease 1.18.
  Генерация этого набора не выполнялась. `--force`/`--legacy-peer-deps` не применялись.

Запросы метаданных воспроизводятся командами (из корня):

```powershell
mise exec -- npm view @typespec/http-server-csharp dist-tags dependencies peerDependencies --json
mise exec -- npm view @typespec/http-server-csharp@0.58.0-alpha.32 dependencies peerDependencies --json
mise exec -- npm view @typespec/http-server-csharp@0.58.0-alpha.34-dev.2 dependencies peerDependencies --json
mise exec -- npm view @typespec/emitter-framework@0.22.0-dev.2 dependencies peerDependencies --json
mise exec -- npm view @typespec/http-canonicalization@0.16.5-dev.4 dependencies peerDependencies --json
```

### Воспроизведение текущего результата

Версии Node/npm/.NET сохранены из исходного окружения ниже. Точные прямые
версии — в `package.json`, транзитивные — в обновлённом `package-lock.json`.
Никаких overrides в итоговом наборе нет. Фактическое дерево:
emitter `0.58.0-alpha.32`, framework `0.21.0`, Alloy core `0.24.1`,
csharp/msbuild `0.24.0`; все ссылки на core deduped.

```powershell
mise exec -- npm ci --prefix docs/experiments/server-models --ignore-scripts
mise exec -- npm ls @alloy-js/core @alloy-js/csharp --prefix docs/experiments/server-models
mise exec -- node docs/experiments/server-models/generate.mjs
mise exec -- dotnet run --project docs/experiments/server-models/Probe.csproj
```

Генерация: код **0**, `Compilation completed successfully`, compiler `1.17.0`.
Вход — побайтовая копия текущего `contract/main.tsp`, без правок. Несмотря на
`output-type=models`, alpha.32 также создаёт controllers/operations и Program.cs.
Probe их не компилирует: явно включает только models и lib. Файлы не исправляются.
Для helpers требуется framework reference `Microsoft.AspNetCore.App`; приложение
при этом не переводится на MVC.

Сборка: код **1**, CS8618 в generated моделях (например, `Meeting.Id`,
`MeetingCreateRequest.GuestName`, `ProblemDetails.Errors`, response `Body`).
Унаследованное `Directory.Build.props` превращает предупреждения в ошибки.
Отключение nullable, предупреждений и линтеров не применялось.
При первой попытке с включением всех helpers дополнительно получен CS1501
в `HttpServiceException.cs:45` (`Headers.Append`). Итоговый probe исключает этот
неиспользуемый моделями MVC-фильтр; CS8618 остаётся самостоятельным блокером.
Это результат сборки под правилами репозитория, а не доказательство невозможности
компиляции на .NET 10 с другими настройками.

`Probe.cs` содержит заготовку сериализации с web-настройками System.Text.Json.
Она **не исполнялась** из-за сборки; не является conformance-тестом и не
подтверждает соответствие схемам. Изучены `ContractConformanceTests.cs` и
`OpenApiContract.cs`: следующему этапу нужна такая же проверка JSON Schema.

Вся матрица ниже (UUID, строковые ID, date/date-time, 200/201, 400/404/409,
enum и необязательные errors) остаётся **не проверена сериализацией**.
Статический просмотр выявил кандидатов для проверки: date представлен DateTime,
enum type — string, errors — non-nullable dictionary без инициализации;
обёртки ответов содержат body/statusCode. Это наблюдения о коде, не результаты
проверки wire-формата. HTTP-обёртки нельзя автоматически считать телами ответов.

### Следующее действие

Не подключать alpha.32 к production. Следующий отдельный шаг — получить upstream
исправление инициализации/nullable и проверить генерацию, сборку при тех же строгих
настройках и полную матрицу JSON Schema. Для next дополнительно нужны совместимые
диапазоны compiler и единый framework во всей цепочке canonicalization.
Linux, MVC-scaffolding и сборка с ослабленными правилами не проверялись.
Положительная генерация не закрывает #49 и не подтверждает интеграцию.

## Результат

На 6 ноября 2026 года проверенный официальный emitter
`@typespec/http-server-csharp@0.58.0-alpha.33` **не генерирует модели текущего
контракта**: загрузка emitter завершается конфликтом версий Alloy. Это блокер
данной комбинации зависимостей, а не доказательство отсутствия генератора или
невозможности генерации C# в принципе. Основной API, DTO и доменная модель не
изменены. Эксперимент не подключён к production-сборке.

## Источники и условия

- [Официальная справка emitter](https://typespec.io/docs/emitters/servers/http-server-csharp/reference/emitter/)
  описывает `output-type=models`, `skip-format` и `emit-mocks=none` (по умолчанию).
- [Описание генерируемого проекта](https://typespec.io/docs/emitters/servers/http-server-csharp/project/)
  описывает scaffolding .NET 9. Это само по себе не подтверждает совместимость
  отдельных моделей с .NET 10.
- [Пакет emitter в npm](https://www.npmjs.com/package/@typespec/http-server-csharp)
  и его установленный `package.json` служат источником версий и зависимостей.
  Транзитивные версии и integrity зафиксированы в локальном `package-lock.json`.

База исследования — `db250f91878d4dd26fbda289d5fc462b369c8d0c`.
Окружение: Windows, Node **24.22.1**, npm **11.19.1**, SDK .NET **10.0.403**.
Прямые зависимости: compiler/http/json-schema/openapi **1.17.0**,
rest/versioning **0.87.0**, http-server-csharp **0.58.0-alpha.33**.
Это версии текущего контракта, совместимые с заявленными peerDependencies
emitter; `--force` и `--legacy-peer-deps` не применялись.

## Воспроизведение

Все команды выполняются из корня checkout. Сначала установить инструменты
проекта (`mise install`); далее:

```powershell
mise exec -- node --version
mise exec -- npm --version
mise exec -- dotnet --version
mise exec -- npm ci --prefix docs/experiments/server-models --ignore-scripts
mise exec -- npm ls @alloy-js/core @alloy-js/csharp --prefix docs/experiments/server-models
mise exec -- node docs/experiments/server-models/generate.mjs
```

`generate.mjs` копирует **неизменённый** `contract/main.tsp` в локальный
игнорируемый `artifacts/`, чтобы разрешение импортов использовало изолированные
зависимости. Запускается установленный compiler, а не скачиваемый через npx.
Фактическая команда внутри каталога эксперимента:

```text
node node_modules/@typespec/compiler/cmd/tsp.js compile artifacts/main.tsp
  --emit @typespec/http-server-csharp
  --option @typespec/http-server-csharp.output-type=models
  --option @typespec/http-server-csharp.skip-format=true
  --output-dir artifacts/generated
```

Переносы здесь для чтения; runner передаёт аргументы напрямую без shell.
`skip-format` исключает только форматирование выходного C#, не проверку
TypeSpec. Конфигурация production OpenAPI не используется и не меняется.

Первичная установка (`npm install --prefix ... --ignore-scripts`) завершилась
с кодом 0: 107 пакетов, 0 уязвимостей по ответу npm в момент проверки.
Повторная установка по lock-файлу и генерация описаны выше.
Генерация дважды завершилась с кодом **1**, включая запуск после полного
завершения установки:

```text
TypeSpec compiler v1.17.0
error js-error: Failed to load <experiment>/node_modules/@typespec/http-server-csharp/dist/src/index.js due to the following JS error: Multiple versions of Alloy are loaded for this project. This will likely cause undesirable behavior.
Found 1 error.
No emitter was configured, no output was generated. Use `--emit <emitterName>` to pick emitter or specify it in the TypeSpec config.
```

Последняя строка — вторичное сообщение после неудачной загрузки; emitter
действительно передан в аргументах. `npm ls` установил причину:

```text
http-server-csharp@0.58.0-alpha.33
  @alloy-js/core@0.25.0
  @alloy-js/csharp@0.25.0
  @typespec/emitter-framework@0.21.0
    @alloy-js/core@0.24.1
    @alloy-js/csharp@0.24.0
```

## Сборка и wire-формат

SDK .NET 10 доступен (команда версии успешна), но **сборка полученных моделей
не выполнена**: C# файлы не получены. Нет основания объявлять сборку на .NET 10
успешной. Заглушки моделей или ручное исправление сгенерированного кода не
использовались. JSON-сериализация также **не выполнена** по той же причине.

Образец будущей проверки —
`backend/BookingCalendar.Api.Tests/ContractConformanceTests.cs` и
`OpenApiContract.cs`: сериализованный JSON должен проходить схемы текущего
`contract/openapi/openapi.yaml`, а не только компилироваться. Следующая матрица
фиксирует ожидаемые проверки; все они пока **не проверены** на generated C#:

| Объект                                        | Требование текущего OpenAPI                                             | Статус       |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| Meeting.id                                    | Строка с форматом UUID                                                  | Не проверено |
| MeetingType.id, meetingTypeId                 | Строковые идентификаторы                                                | Не проверено |
| Meeting.start/end, MeetingCreateRequest.start | Строки date-time со смещением                                           | Не проверено |
| SlotsResponse и слоты                         | Даты date, время date-time, коллекции и available                       | Не проверено |
| HealthResponse                                | `status` равен `ok`                                                     | Не проверено |
| Ответы 200/201                                | Тела MeetingType, Meeting, массивы и SlotsResponse; camelCase           | Не проверено |
| Ответы 400/404/409                            | ProblemDetails: строковый enum type, числовой status, detail/instance   | Не проверено |
| ProblemDetails.errors                         | Необязательный словарь массивов строк; отсутствие без validation-failed | Не проверено |

Сериализатору будущего probe нужны web-настройки System.Text.Json, как у
Minimal API. Следует проверить именование свойств, enum, отсутствие лишней
обёртки `body/statusCode`, сохранение смещения дат и необязательные поля.
Даже прохождение JSON Schema не доказывает сохранение HTTP-кодов и правил
бронирования: это остаётся обязанностью существующих HTTP-тестов.

## Вывод и следующее действие

Подтверждены наличие режима `models`, совпадение peer-версий с текущим
TypeSpec и воспроизводимый **конфликт транзитивных зависимостей при загрузке**.
Совместимость C#, .NET 10 и wire-формата не установлена. Старые версии,
принудительные overrides Alloy, Linux и MVC-scaffolding не исследованы.

Рекомендация: отдельным решением проверить исправленный upstream-релиз либо
согласованную upstream комбинацию Alloy/emitter-framework, повторить генерацию,
затем собрать неизменённые модели в изолированном `net10.0` probe и прогнать
матрицу сериализации по OpenAPI. Не подключать этот пакет к production до
получения этих доказательств. Выбор другого генератора, отказ от генерации и
замена DTO остаются отдельными решениями. Даже положительный последующий
эксперимент сам по себе не выполняет требование интеграции серверной генерации.
