using System.Text;

namespace BookingCalendar.Api.Tests;

// Общие HTTP-шаги для тестов встреч: данные готовятся только через публичный API
// (спека #23, Testing Decisions #5), сид напрямую в хранилище запрещён.
internal static class MeetingHttp
{
    public static DateTimeOffset Moscow(int day, int hour, int minute) =>
        new(new DateTime(2026, 11, day, hour, minute, 0, DateTimeKind.Unspecified), TimeSpan.FromHours(3));

    public static async Task<HttpResponseMessage> CreateMeetingTypeAsync(
        HttpClient client,
        string id,
        string title,
        int durationMinutes)
    {
        using var content = new StringContent(
            $$"""{"id":"{{id}}","title":"{{title}}","description":"","durationMinutes":{{durationMinutes}}}""",
            Encoding.UTF8,
            "application/json");
        return await client.PostAsync("/api/meeting-types", content);
    }

    public static async Task<HttpResponseMessage> CreateMeetingAsync(
        HttpClient client,
        string meetingTypeId,
        DateTimeOffset start,
        string guestName)
    {
        using var content = new StringContent(
            $$"""{"meetingTypeId":"{{meetingTypeId}}","start":"{{start:yyyy-MM-ddTHH:mm:sszzz}}","guestName":"{{guestName}}"}""",
            Encoding.UTF8,
            "application/json");
        return await client.PostAsync("/api/meetings", content);
    }

    public static async Task<HttpResponseMessage> PostJsonAsync(HttpClient client, string path, string json)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        return await client.PostAsync(path, content);
    }
}
