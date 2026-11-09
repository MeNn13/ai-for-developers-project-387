using System.Net;
using System.Text.Json;

namespace BookingCalendar.Api.Tests;

public class MeetingTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task CreateMeetingReturnsCreatedMeetingWithTypeSnapshotAndComputedEnd()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "meeting-create", "Знакомство", 45);

        using var response = await MeetingHttp.CreateMeetingAsync(
            client,
            "meeting-create",
            MeetingHttp.Moscow(2, 11, 0),
            "Анна");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var meeting = document.RootElement;
        Assert.True(Guid.TryParse(meeting.GetProperty("id").GetString(), out _));
        Assert.Equal("meeting-create", meeting.GetProperty("meetingTypeId").GetString());
        Assert.Equal("Знакомство", meeting.GetProperty("meetingTypeTitle").GetString());
        Assert.Equal(45, meeting.GetProperty("durationMinutes").GetInt32());
        Assert.Equal("2026-11-02T11:00:00+03:00", meeting.GetProperty("start").GetString());
        Assert.Equal("2026-11-02T11:45:00+03:00", meeting.GetProperty("end").GetString());
        Assert.Equal("Анна", meeting.GetProperty("guestName").GetString());
    }

    [Theory]
    [InlineData("reject-past", 30, 2, 10, 0, 10, 0)]
    [InlineData("reject-grid", 30, 2, 10, 15, 8, 0)]
    [InlineData("reject-window", 30, 16, 10, 0, 8, 0)]
    [InlineData("reject-weekend", 30, 7, 10, 0, 8, 0)]
    [InlineData("reject-late-end", 60, 2, 17, 30, 8, 0)]
    public async Task CreateMeetingRejectsStartsThatAreNotSlots(
        string typeId,
        int durationMinutes,
        int day,
        int hour,
        int minute,
        int nowHour,
        int nowMinute)
    {
        app.SetNow(MeetingHttp.Moscow(2, nowHour, nowMinute));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, typeId, "Правила", durationMinutes);

        using var response = await MeetingHttp.CreateMeetingAsync(
            client,
            typeId,
            MeetingHttp.Moscow(day, hour, minute),
            "Анна");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "slot-not-bookable");
    }

    [Fact]
    public async Task CreateMeetingReturnsNotFoundForUnknownMeetingType()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();

        using var response = await MeetingHttp.CreateMeetingAsync(
            client,
            "missing-meeting-type",
            MeetingHttp.Moscow(2, 10, 0),
            "Анна");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "meeting-type-not-found");
    }

    [Fact]
    public async Task CreateMeetingRejectsOverlapWithMeetingOfAnotherType()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "overlap-long", "Длинная", 60);
        await CreateTypeAsync(client, "overlap-short", "Короткая", 30);

        using var first = await MeetingHttp.CreateMeetingAsync(
            client,
            "overlap-long",
            MeetingHttp.Moscow(3, 10, 0),
            "Анна");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Встреча другого типа пересекается с [10:00, 11:00) — слот занят.
        using var second = await MeetingHttp.CreateMeetingAsync(
            client,
            "overlap-short",
            MeetingHttp.Moscow(3, 10, 30),
            "Борис");

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        await ProblemAssertions.AssertProblem(second, "slot-taken");
    }

    [Fact]
    public async Task CreateMeetingAllowsBackToBackMeetings()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "back-to-back-long", "Длинная", 60);
        await CreateTypeAsync(client, "back-to-back-short", "Короткая", 30);

        using var next = await MeetingHttp.CreateMeetingAsync(
            client,
            "back-to-back-short",
            MeetingHttp.Moscow(4, 11, 0),
            "Анна");
        Assert.Equal(HttpStatusCode.Created, next.StatusCode);

        // Встреча 10:00–11:00 кончается ровно в старт следующей — не блокирует.
        using var earlier = await MeetingHttp.CreateMeetingAsync(
            client,
            "back-to-back-long",
            MeetingHttp.Moscow(4, 10, 0),
            "Борис");

        Assert.Equal(HttpStatusCode.Created, earlier.StatusCode);
    }

    [Theory]
    [InlineData("""{"start":"2026-11-02T10:00:00+03:00","guestName":"Анна"}""", "meetingTypeId")]
    [InlineData("""{"meetingTypeId":"validation-type","guestName":"Анна"}""", "start")]
    [InlineData("""{"meetingTypeId":"validation-type","start":"2026-11-02T10:00:00","guestName":"Анна"}""", "start")]
    [InlineData("""{"meetingTypeId":"validation-type","start":"2026-11-02","guestName":"Анна"}""", "start")]
    [InlineData("""{"meetingTypeId":"validation-type","start":"2026-11-02T10:00:00+03:00","guestName":""}""", "guestName")]
    [InlineData("""{"meetingTypeId":"validation-type","start":"2026-11-02T10:00:00+03:00"}""", "guestName")]
    public async Task CreateMeetingRejectsInvalidBody(string json, string field)
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();

        using var response = await MeetingHttp.PostJsonAsync(client, "/api/meetings", json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(document.RootElement.GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task CreateMeetingRejectsMalformedJsonAndTooLongGuestName()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "validation-name", "Проверка", 30);

        using var malformed = await MeetingHttp.PostJsonAsync(client, "/api/meetings", "not json");
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        await ProblemAssertions.AssertProblem(malformed, "validation-failed");

        var longName = new string('а', 101);
        using var tooLong = await MeetingHttp.CreateMeetingAsync(
            client,
            "validation-name",
            MeetingHttp.Moscow(2, 10, 0),
            longName);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        await ProblemAssertions.AssertProblem(tooLong, "validation-failed");
    }

    [Fact]
    public async Task BookedSlotBecomesUnavailableInSlotsResponse()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        await CreateTypeAsync(client, "slots-booked", "Слоты", 30);

        Assert.True(await IsSlotAvailableAsync(client, "slots-booked", "2026-11-05T10:00:00+03:00"));

        using var created = await MeetingHttp.CreateMeetingAsync(
            client,
            "slots-booked",
            MeetingHttp.Moscow(5, 10, 0),
            "Анна");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        Assert.False(await IsSlotAvailableAsync(client, "slots-booked", "2026-11-05T10:00:00+03:00"));
    }

    private static async Task CreateTypeAsync(
        HttpClient client,
        string id,
        string title,
        int durationMinutes)
    {
        using var response = await MeetingHttp.CreateMeetingTypeAsync(client, id, title, durationMinutes);
        response.EnsureSuccessStatusCode();
    }

    private static async Task<bool> IsSlotAvailableAsync(
        HttpClient client,
        string meetingTypeId,
        string start)
    {
        using var response = await client.GetAsync($"/api/slots?meetingTypeId={meetingTypeId}");
        response.EnsureSuccessStatusCode();

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var slot = document.RootElement
            .GetProperty("days")
            .EnumerateArray()
            .SelectMany(day => day.GetProperty("slots").EnumerateArray())
            .Single(candidate => candidate.GetProperty("start").GetString() == start);

        return slot.GetProperty("available").GetBoolean();
    }
}
