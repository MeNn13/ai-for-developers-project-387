import "@typespec/http";
import "@typespec/json-schema";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.JsonSchema;
using TypeSpec.OpenAPI;

@service(#{ title: "Booking Calendar API" })
@server("http://127.0.0.1:5000", "Локальная разработка")
@doc("API сервиса бронирования календаря.")
@route("/api")
namespace BookingCalendar;

@route("/health")
@get
@tag("health")
@doc("Проверяет, что API отвечает.")
@operationId("getHealth")
op health(): HealthResponse;

@doc("Состояние API.")
@example(#{ status: "ok" })
model HealthResponse {
  @doc("Признак того, что API отвечает.")
  status: "ok";
}

@route("/meeting-types")
@get
@tag("meeting-types")
@doc("Возвращает типы встреч в порядке создания; новый тип — в конце списка.")
@operationId("listMeetingTypes")
op listMeetingTypes(): MeetingType[];

@route("/meeting-types")
@post
@tag("meeting-types")
@doc("Создаёт тип встречи и возвращает созданный тип.")
@operationId("createMeetingType")
@opExample(
  #{
    returnType: #{
      statusCode: 400,
      body: #{
        type: "validation-failed",
        title: "Запрос некорректен",
        status: 400,
        detail: "Поля запроса не прошли проверку.",
        instance: "/api/meeting-types",
        errors: #{
          id: #["Разрешены только строчные латинские буквы, цифры и дефис"],
          durationMinutes: #["Длительность должна быть от 15 до 480 минут"],
        },
      },
    },
  },
  #{ description: "Id с недопустимыми символами и длительность вне диапазона." }
)
@opExample(
  #{
    returnType: #{
      statusCode: 409,
      body: #{
        type: "meeting-type-exists",
        title: "Конфликт",
        status: 409,
        detail: "Тип встречи с таким id уже существует.",
        instance: "/api/meeting-types",
      },
    },
  },
  #{ description: "Повторное создание типа с тем же id." }
)
op createMeetingType(@body body: MeetingTypeCreateRequest):
  | MeetingTypeCreatedResponse
  | ValidationError
  | MeetingTypeExistsError;

@route("/slots")
@get
@tag("slots")
@doc("Возвращает снимок слотов выбранного типа встречи на 14 дней вперёд.")
@operationId("listSlots")
@opExample(
  #{
    returnType: #{
      statusCode: 400,
      body: #{
        type: "validation-failed",
        title: "Запрос некорректен",
        status: 400,
        detail: "Параметр meetingTypeId обязателен.",
        instance: "/api/slots",
        errors: #{
          meetingTypeId: #["Параметр «meetingTypeId» обязателен"],
        },
      },
    },
  },
  #{ description: "Запрос без обязательного параметра meetingTypeId." }
)
@opExample(
  #{
    returnType: #{
      statusCode: 404,
      body: #{
        type: "meeting-type-not-found",
        title: "Не найдено",
        status: 404,
        detail: "Тип встречи с таким id не найден.",
        instance: "/api/slots",
      },
    },
  },
  #{ description: "Неизвестный meetingTypeId." }
)
op listSlots(@query @doc("Идентификатор типа встречи, для которого считаются слоты.")
  meetingTypeId: string): SlotsResponse | ValidationError | MeetingTypeNotFoundError;

@route("/meetings")
@post
@tag("meetings")
@doc("Создаёт встречу на свободном слоте и возвращает её; конец вычисляется из длительности типа.")
@operationId("createMeeting")
@opExample(
  #{
    returnType: #{
      statusCode: 400,
      body: #{
        type: "validation-failed",
        title: "Запрос некорректен",
        status: 400,
        detail: "Поля запроса не прошли проверку.",
        instance: "/api/meetings",
        errors: #{
          guestName: #["Поле «Ваше имя» обязательно"],
          start: #["Время начала должно быть в формате ISO 8601 со смещением"],
        },
      },
    },
  },
  #{ description: "Пустое имя гостя и время без смещения." }
)
@opExample(
  #{
    returnType: #{
      statusCode: 400,
      body: #{
        type: "slot-not-bookable",
        title: "Слот недоступен",
        status: 400,
        detail: "Это время не является слотом записи.",
        instance: "/api/meetings",
      },
    },
  },
  #{ description: "Старт в прошлом, вне сетки, окна или рабочих часов." }
)
@opExample(
  #{
    returnType: #{
      statusCode: 404,
      body: #{
        type: "meeting-type-not-found",
        title: "Не найдено",
        status: 404,
        detail: "Тип встречи с таким id не найден.",
        instance: "/api/meetings",
      },
    },
  },
  #{ description: "Неизвестный meetingTypeId." }
)
@opExample(
  #{
    returnType: #{
      statusCode: 409,
      body: #{
        type: "slot-taken",
        title: "Слот занят",
        status: 409,
        detail: "Это время уже занято другой встречей.",
        instance: "/api/meetings",
      },
    },
  },
  #{ description: "Интервал пересекается с существующей встречей." }
)
op createMeeting(@body body: MeetingCreateRequest):
  | MeetingCreatedResponse
  | ValidationError
  | SlotNotBookableError
  | MeetingTypeNotFoundError
  | SlotTakenError;

@route("/meetings")
@get
@tag("meetings")
@doc("Возвращает предстоящие встречи по возрастанию начала; пусто — пустой список.")
@operationId("listMeetings")
op listMeetings(): Meeting[];

@doc("Тип встречи: шаблон с названием, описанием и длительностью.")
@example(#{
  id: "znakomstvo",
  title: "Знакомство",
  description: "Короткий первый созвон.",
  durationMinutes: 30,
})
model MeetingType {
  @doc("Короткий идентификатор типа встречи.")
  @minLength(1)
  @maxLength(64)
  @pattern("^[a-z0-9-]+$")
  id: string;

  @doc("Название типа встречи.")
  @minLength(1)
  @maxLength(120)
  title: string;

  @doc("Описание для гостя; пустая строка допустима.")
  @maxLength(500)
  description: string;

  @doc("Длительность встречи в минутах.")
  @minValue(15)
  @maxValue(480)
  @multipleOf(5)
  durationMinutes: int32;
}

@doc("Запрос на создание типа встречи.")
@example(#{
  id: "znakomstvo",
  title: "Знакомство",
  description: "Короткий первый созвон.",
  durationMinutes: 30,
})
model MeetingTypeCreateRequest {
  @doc("Короткий идентификатор типа встречи.")
  @minLength(1)
  @maxLength(64)
  @pattern("^[a-z0-9-]+$")
  id: string;

  @doc("Название типа встречи.")
  @minLength(1)
  @maxLength(120)
  title: string;

  @doc("Описание для гостя; пустая строка допустима.")
  @maxLength(500)
  description: string;

  @doc("Длительность встречи в минутах.")
  @minValue(15)
  @maxValue(480)
  @multipleOf(5)
  durationMinutes: int32;
}

@doc("Слот: интервал, который начинается в точке сетки стартов и длится столько же, сколько выбранный тип встречи.")
@example(#{
  start: offsetDateTime.fromISO("2026-11-02T10:00:00+03:00"),
  end: offsetDateTime.fromISO("2026-11-02T10:30:00+03:00"),
  available: true,
})
model Slot {
  @doc("Начало слота по московскому времени.")
  start: offsetDateTime;

  @doc("Конец слота: начало плюс длительность типа встречи.")
  end: offsetDateTime;

  @doc("Свободен ли слот: true — можно бронировать, false — пересекается со встречей.")
  available: boolean;
}

@doc("День окна записи со слотами выбранного типа; у выходного дня и дня без кандидатов массив пуст.")
@example(#{
  date: plainDate.fromISO("2026-11-02"),
  slots: #[
    #{ start: offsetDateTime.fromISO("2026-11-02T10:00:00+03:00"), end: offsetDateTime.fromISO("2026-11-02T10:30:00+03:00"), available: true },
  ],
})
model SlotDay {
  @doc("Дата дня в формате YYYY-MM-DD.")
  date: plainDate;

  @doc("Слоты дня по возрастанию начала.")
  slots: Slot[];
}

@doc("Границы окна записи.")
@example(#{
  from: plainDate.fromISO("2026-11-02"),
  to: plainDate.fromISO("2026-11-15"),
})
model SlotWindow {
  @doc("Первый день окна — сегодня по московскому времени.")
  from: plainDate;

  @doc("Последний день окна — сегодня плюс 13 дней.")
  to: plainDate;
}

@doc("Снимок слотов на 14 дней вперёд для выбранного типа встречи.")
@example(#{
  timezone: "Europe/Moscow",
  window: #{ from: plainDate.fromISO("2026-11-02"), to: plainDate.fromISO("2026-11-15") },
  days: #[
    #{
      date: plainDate.fromISO("2026-11-02"),
      slots: #[
        #{ start: offsetDateTime.fromISO("2026-11-02T10:00:00+03:00"), end: offsetDateTime.fromISO("2026-11-02T10:30:00+03:00"), available: true },
        #{ start: offsetDateTime.fromISO("2026-11-02T10:30:00+03:00"), end: offsetDateTime.fromISO("2026-11-02T11:00:00+03:00"), available: false },
      ],
    },
    #{ date: plainDate.fromISO("2026-11-03"), slots: #[] },
  ],
})
model SlotsResponse {
  @doc("Часовой пояс, в котором отданы даты и время.")
  timezone: string;

  @doc("Границы окна записи.")
  window: SlotWindow;

  @doc("Ровно 14 дней по возрастанию даты, включая выходные и дни без кандидатов.")
  days: SlotDay[];
}

@doc("Встреча: занятый интервал с типом на момент брони и именем гостя.")
@example(#{
  id: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  meetingTypeId: "znakomstvo",
  meetingTypeTitle: "Знакомство",
  durationMinutes: 30,
  start: offsetDateTime.fromISO("2026-11-02T10:00:00+03:00"),
  end: offsetDateTime.fromISO("2026-11-02T10:30:00+03:00"),
  guestName: "Анна",
})
model Meeting {
  @doc("Уникальный идентификатор встречи.")
  @format("uuid")
  id: string;

  @doc("Идентификатор типа встречи, по которому забронирована встреча.")
  @minLength(1)
  @maxLength(64)
  meetingTypeId: string;

  @doc("Название типа встречи на момент брони.")
  @minLength(1)
  @maxLength(120)
  meetingTypeTitle: string;

  @doc("Длительность встречи на момент брони, в минутах.")
  @minValue(15)
  @maxValue(480)
  @multipleOf(5)
  durationMinutes: int32;

  @doc("Начало встречи по московскому времени.")
  start: offsetDateTime;

  @doc("Конец встречи по московскому времени: начало плюс длительность.")
  end: offsetDateTime;

  @doc("Имя гостя, указанное при бронировании.")
  @minLength(1)
  @maxLength(100)
  guestName: string;
}

@doc("Запрос на бронирование встречи; конец сервер вычисляет из длительности типа.")
@example(#{
  meetingTypeId: "znakomstvo",
  start: offsetDateTime.fromISO("2026-11-02T10:00:00+03:00"),
  guestName: "Анна",
})
model MeetingCreateRequest {
  @doc("Идентификатор типа встречи.")
  @minLength(1)
  @maxLength(64)
  meetingTypeId: string;

  @doc("Начало встречи в формате ISO 8601 со смещением; сервер приводит время к Москве.")
  start: offsetDateTime;

  @doc("Имя гостя.")
  @minLength(1)
  @maxLength(100)
  guestName: string;
}

@doc("Встреча создана.")
model MeetingCreatedResponse {
  @statusCode
  statusCode: 201;

  @body
  body: Meeting;
}

@doc("Старт не является слотом по правилам записи.")
model SlotNotBookableError {
  @statusCode
  statusCode: 400;

  @body
  body: ProblemDetails;
}

@doc("Слот уже занят другой встречей.")
model SlotTakenError {
  @statusCode
  statusCode: 409;

  @body
  body: ProblemDetails;
}

alias ErrorSlug =
  | "validation-failed"
  | "slot-not-bookable"
  | "meeting-type-not-found"
  | "not-found"
  | "meeting-type-exists"
  | "slot-taken";

@doc("Описание ошибки в формате RFC 7807 Problem Details.")
@example(#{
  type: "not-found",
  title: "Не найдено",
  status: 404,
  detail: "Запрошенный маршрут API не существует.",
  instance: "/api/meeting-types",
})
model ProblemDetails {
  @doc("Короткий slug ошибки.")
  type: ErrorSlug;

  @doc("Краткий заголовок ошибки для человека.")
  title: string;

  @doc("HTTP-код ответа.")
  status: int32;

  @doc("Понятное описание ошибки для человека.")
  detail: string;

  @doc("Путь запроса, на котором произошла ошибка.")
  instance: string;

  @doc("Сообщения по полям; присутствует только у ошибки validation-failed.")
  errors?: Record<string[]>;
}

@doc("Тип встречи создан.")
model MeetingTypeCreatedResponse {
  @statusCode
  statusCode: 201;

  @body
  body: MeetingType;
}

@doc("Поля запроса не прошли проверку.")
model ValidationError {
  @statusCode
  statusCode: 400;

  @body
  body: ProblemDetails;
}

@doc("Тип встречи с таким id уже существует.")
model MeetingTypeExistsError {
  @statusCode
  statusCode: 409;

  @body
  body: ProblemDetails;
}

@doc("Тип встречи с таким id не найден.")
model MeetingTypeNotFoundError {
  @statusCode
  statusCode: 404;

  @body
  body: ProblemDetails;
}
