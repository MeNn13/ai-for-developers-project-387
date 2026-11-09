using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;

namespace BookingCalendar.Api.Tests;

public class SlotTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [InlineData("/api/slots")]
    [InlineData("/api/slots?meetingTypeId=")]
    [InlineData("/api/slots?meetingTypeId=%20")]
    public async Task ListSlotsRequiresMeetingTypeId(string url)
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
    }

    [Fact]
    public async Task ListSlotsReturnsNotFoundForUnknownMeetingType()
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/api/slots?meetingTypeId=missing-type");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "meeting-type-not-found");
    }

    [Fact]
    public async Task ListSlotsReturnsFourteenDaysWithMoscowTimeAndOffset()
    {
        app.SetNow(Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateMeetingTypeAsync(client, "slots-shape", durationMinutes: 30);

        using var response = await client.GetAsync("/api/slots?meetingTypeId=slots-shape");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.Equal("Europe/Moscow", root.GetProperty("timezone").GetString());

        var window = root.GetProperty("window");
        Assert.Equal("2026-11-02", window.GetProperty("from").GetString());
        Assert.Equal("2026-11-15", window.GetProperty("to").GetString());

        var days = root.GetProperty("days").EnumerateArray().ToList();
        Assert.Equal(14, days.Count);
        Assert.Equal(
            Enumerable.Range(0, 14).Select(offset => new DateOnly(2026, 11, 2).AddDays(offset)),
            days.Select(day => DateOnly.ParseExact(
                day.GetProperty("date").GetString()!,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture)));

        // Суббота и воскресенье попадают в окно, но остаются пустыми массивами.
        foreach (var weekend in new[] { "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15" })
        {
            var day = days.Single(day => day.GetProperty("date").GetString() == weekend);
            Assert.Empty(day.GetProperty("slots").EnumerateArray());
        }

        var firstDaySlots = days[0].GetProperty("slots").EnumerateArray().ToList();
        Assert.Equal(16, firstDaySlots.Count);

        var first = firstDaySlots[0];
        Assert.Equal("2026-11-02T10:00:00+03:00", first.GetProperty("start").GetString());
        Assert.Equal("2026-11-02T10:30:00+03:00", first.GetProperty("end").GetString());
        Assert.True(first.GetProperty("available").GetBoolean());
        Assert.Equal("2026-11-02T17:30:00+03:00", firstDaySlots[^1].GetProperty("start").GetString());

        // Смещение +03:00 в каждом слоте доказывает, что ответ не зависит от TZ машины.
        foreach (var slot in days.SelectMany(day => day.GetProperty("slots").EnumerateArray()))
        {
            Assert.EndsWith("+03:00", slot.GetProperty("start").GetString(), StringComparison.Ordinal);
            Assert.EndsWith("+03:00", slot.GetProperty("end").GetString(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ListSlotsSkipsStartsNotStrictlyAfterNow()
    {
        app.SetNow(Moscow(2, 10, 0));
        using var client = app.CreateClient();
        await CreateMeetingTypeAsync(client, "slots-now", durationMinutes: 30);

        using var response = await client.GetAsync("/api/slots?meetingTypeId=slots-now");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var firstStart = document.RootElement
            .GetProperty("days")[0]
            .GetProperty("slots")[0]
            .GetProperty("start")
            .GetString();

        // 10:00 равно «сейчас» и не предлагается: начало должно быть строго в будущем.
        Assert.Equal("2026-11-02T10:30:00+03:00", firstStart);
    }

    [Theory]
    [InlineData(60, 15, "2026-11-02T11:00:00+03:00", "2026-11-02T17:00:00+03:00")]
    [InlineData(480, 1, "2026-11-02T18:00:00+03:00", "2026-11-02T10:00:00+03:00")]
    public async Task ListSlotsUsesMeetingTypeDuration(
        int durationMinutes,
        int expectedCount,
        string expectedFirstEnd,
        string expectedLastStart)
    {
        app.SetNow(Moscow(2, 8, 0));
        using var client = app.CreateClient();
        var id = $"slots-duration-{durationMinutes}";
        await CreateMeetingTypeAsync(client, id, durationMinutes);

        using var response = await client.GetAsync($"/api/slots?meetingTypeId={id}");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var slots = document.RootElement.GetProperty("days")[0].GetProperty("slots").EnumerateArray().ToList();

        Assert.Equal(expectedCount, slots.Count);
        Assert.Equal(expectedFirstEnd, slots[0].GetProperty("end").GetString());
        Assert.Equal(expectedLastStart, slots[^1].GetProperty("start").GetString());
    }

    [Fact]
    public async Task ListSlotsReturnsOkWithEmptyDayWhenNoCandidatesLeft()
    {
        app.SetNow(Moscow(2, 10, 30));
        using var client = app.CreateClient();
        await CreateMeetingTypeAsync(client, "slots-empty-day", durationMinutes: 480);

        using var response = await client.GetAsync("/api/slots?meetingTypeId=slots-empty-day");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var days = document.RootElement.GetProperty("days");

        // 480 минут помещаются только в старт 10:00, а он уже в прошлом.
        Assert.Empty(days[0].GetProperty("slots").EnumerateArray());
        Assert.Single(days[1].GetProperty("slots").EnumerateArray());
    }

    private static DateTimeOffset Moscow(int day, int hour, int minute) =>
        new(new DateTime(2026, 11, day, hour, minute, 0, DateTimeKind.Unspecified), TimeSpan.FromHours(3));

    private static async Task CreateMeetingTypeAsync(HttpClient client, string id, int durationMinutes)
    {
        using var content = new StringContent(
            $$"""{"id":"{{id}}","title":"Тестовый тип","description":"","durationMinutes":{{durationMinutes}}}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        response.EnsureSuccessStatusCode();
    }
}
