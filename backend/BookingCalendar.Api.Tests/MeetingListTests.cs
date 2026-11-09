using System.Net;
using System.Text.Json;

namespace BookingCalendar.Api.Tests;

public class MeetingListTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task ListMeetingsReturnsUpcomingMeetingsAscendingByStart()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "list-order", "Порядок", 30);

        using var later = await MeetingHttp.CreateMeetingAsync(
            client,
            "list-order",
            MeetingHttp.Moscow(2, 11, 0),
            "Анна");
        Assert.Equal(HttpStatusCode.Created, later.StatusCode);

        using var earlier = await MeetingHttp.CreateMeetingAsync(
            client,
            "list-order",
            MeetingHttp.Moscow(2, 10, 0),
            "Борис");
        Assert.Equal(HttpStatusCode.Created, earlier.StatusCode);

        var meetings = await ListMeetingsOfTypeAsync(client, "list-order");

        Assert.Equal(
            ["2026-11-02T10:00:00+03:00", "2026-11-02T11:00:00+03:00"],
            meetings.Select(meeting => meeting.GetProperty("start").GetString()));
        Assert.Equal("Борис", meetings[0].GetProperty("guestName").GetString());
    }

    [Fact]
    public async Task ListMeetingsKeepsInProgressMeetingAndDropsFinishedOnes()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "list-filter", "Фильтр", 30);

        using var created = await MeetingHttp.CreateMeetingAsync(
            client,
            "list-filter",
            MeetingHttp.Moscow(3, 10, 0),
            "Анна");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        // 10:15 — встреча идёт, end 10:30 > now, поэтому она остаётся в списке.
        app.SetNow(MeetingHttp.Moscow(3, 10, 15));
        Assert.Single(await ListMeetingsOfTypeAsync(client, "list-filter"));

        // 10:40 — встреча закончилась, в предстоящих её нет.
        app.SetNow(MeetingHttp.Moscow(3, 10, 40));
        Assert.Empty(await ListMeetingsOfTypeAsync(client, "list-filter"));
    }

    private static async Task CreateTypeAsync(HttpClient client, string id, string title, int durationMinutes)
    {
        using var response = await MeetingHttp.CreateMeetingTypeAsync(client, id, title, durationMinutes);
        response.EnsureSuccessStatusCode();
    }

    private static async Task<IReadOnlyList<JsonElement>> ListMeetingsOfTypeAsync(
        HttpClient client,
        string meetingTypeId)
    {
        using var response = await client.GetAsync("/api/meetings");
        response.EnsureSuccessStatusCode();

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return
        [
            .. document.RootElement
                .EnumerateArray()
                .Where(meeting => meeting.GetProperty("meetingTypeId").GetString() == meetingTypeId)
                .Select(meeting => meeting.Clone()),
        ];
    }
}
