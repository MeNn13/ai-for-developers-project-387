using System.Text.Json;

namespace BookingCalendar.Api.Http;

// Общие шаги разбора JSON-тела для эндпоинтов встреч и типов встреч: чтение
// документа и накопление ошибок по полям. Вызываются вне критической секции
// хранилища (ADR 0001).
internal static class JsonRequest
{
    public static async Task<JsonDocument?> ParseBodyAsync(HttpRequest request)
    {
        try
        {
            return await JsonDocument.ParseAsync(
                request.Body,
                cancellationToken: request.HttpContext.RequestAborted);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static void AddError(
        Dictionary<string, List<string>> errors,
        string field,
        string message)
    {
        if (!errors.TryGetValue(field, out var messages))
        {
            messages = [];
            errors[field] = messages;
        }

        messages.Add(message);
    }
}
