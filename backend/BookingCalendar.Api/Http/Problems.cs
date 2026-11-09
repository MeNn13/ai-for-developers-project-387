using System.Text.Json;
using System.Text.Json.Serialization;

using ProblemDto = BookingCalendar.ProblemDetails;

namespace BookingCalendar.Api.Http;

// Все ошибки API отдаются как application/problem+json по схеме ProblemDetails
// из контракта: type — короткий slug, title и detail — русский текст для человека.
internal static class Problems
{
    private static readonly JsonSerializerOptions s_problemJsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static IResult ValidationFailed(
        string instance,
        string detail,
        IReadOnlyDictionary<string, string[]>? errors = null) =>
        Create("validation-failed", "Запрос некорректен", StatusCodes.Status400BadRequest, instance, detail, errors);

    public static IResult NotFound(string instance) =>
        Create("not-found", "Не найдено", StatusCodes.Status404NotFound, instance, "Маршрут API не существует.");

    public static IResult MeetingTypeNotFound(string instance) =>
        Create("meeting-type-not-found", "Не найдено", StatusCodes.Status404NotFound, instance, "Тип встречи с таким id не найден.");

    public static IResult MeetingTypeExists(string instance) =>
        Create("meeting-type-exists", "Конфликт", StatusCodes.Status409Conflict, instance, "Тип встречи с таким id уже существует.");

    public static IResult SlotNotBookable(string instance) =>
        Create("slot-not-bookable", "Слот недоступен", StatusCodes.Status400BadRequest, instance, "Это время не является слотом для бронирования.");

    public static IResult SlotTaken(string instance) =>
        Create("slot-taken", "Слот занят", StatusCodes.Status409Conflict, instance, "Это время уже занято другой встречей.");

    private static IResult Create(
        string slug,
        string title,
        int statusCode,
        string instance,
        string detail,
        IReadOnlyDictionary<string, string[]>? errors = null)
    {
        var problem = new ProblemDto
        {
            Type = slug,
            Title = title,
            Status = statusCode,
            Detail = detail,
            Instance = instance,
            Errors = errors?.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        };
        return Results.Json(problem, s_problemJsonOptions, "application/problem+json", statusCode);
    }
}
