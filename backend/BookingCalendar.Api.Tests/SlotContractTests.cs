using System.Net;
using System.Text.Json.Nodes;

using static BookingCalendar.Api.Tests.OpenApiContract;

namespace BookingCalendar.Api.Tests;

public class SlotContractTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task NonemptySlotResponseKeepsFormatsAndChangesAvailabilityAfterBooking()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        using var type = await MeetingHttp.CreateMeetingTypeAsync(client, "contract-slots", "Слоты", 30);
        type.EnsureSuccessStatusCode();
        var before = await ReadSlotsAsync(client);
        Assert.Equal("Europe/Moscow", before["timezone"]!.GetValue<string>());
        Assert.Equal("2026-11-02", before["window"]!["from"]!.GetValue<string>());
        Assert.Equal("2026-11-15", before["window"]!["to"]!.GetValue<string>());
        Assert.Equal(14, before["days"]!.AsArray().Count);
        var firstDay = before["days"]![0]!;
        Assert.Equal("2026-11-02", firstDay["date"]!.GetValue<string>());
        var firstSlot = firstDay["slots"]![0]!;
        Assert.Equal("2026-11-02T10:00:00+03:00", firstSlot["start"]!.GetValue<string>());
        Assert.Equal("2026-11-02T10:30:00+03:00", firstSlot["end"]!.GetValue<string>());
        Assert.True(firstSlot["available"]!.GetValue<bool>());

        using var created = await MeetingHttp.CreateMeetingAsync(client, "contract-slots", MeetingHttp.Moscow(2, 10, 0), "Анна");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var after = await ReadSlotsAsync(client);
        Assert.False(after["days"]![0]!["slots"]![0]!["available"]!.GetValue<bool>());
        Assert.True(after["days"]![0]!["slots"]![1]!["available"]!.GetValue<bool>());

        var schema = OpenApiContract.Instance.ResponseSchema("/api/slots", "get", 200);
        var timestampAsDate = after.DeepClone();
        timestampAsDate["window"]!["from"] = "2026-11-02T00:00:00+03:00";
        Assert.False(Matches(schema, timestampAsDate));
        var impossibleDate = after.DeepClone();
        impossibleDate["days"]![0]!["date"] = "2026-02-30";
        Assert.False(Matches(schema, impossibleDate));
        var dateAsTimestamp = after.DeepClone();
        dateAsTimestamp["days"]![0]!["slots"]![0]!["start"] = "2026-11-02";
        Assert.False(Matches(schema, dateAsTimestamp));
        var stringAvailability = after.DeepClone();
        stringAvailability["days"]![0]!["slots"]![0]!["available"] = "false";
        Assert.False(Matches(schema, stringAvailability));
        Assert.False(Matches(schema, new JsonObject { ["body"] = after.DeepClone(), ["statusCode"] = 200 }));
    }

    [Theory]
    [InlineData("/api/slots", "validation-failed", 400, "Параметр meetingTypeId обязателен.", true)]
    [InlineData("/api/slots?meetingTypeId=", "validation-failed", 400, "Параметр meetingTypeId обязателен.", true)]
    [InlineData("/api/slots?meetingTypeId=%20", "validation-failed", 400, "Параметр meetingTypeId обязателен.", true)]
    [InlineData("/api/slots?meetingTypeId=contract-missing", "meeting-type-not-found", 404, "Тип встречи с таким id не найден.", false)]
    public async Task QueryProblemsPreserveDetailsAndOptionalErrors(string url, string slug, int status, string detail, bool hasErrors)
    {
        using var client = app.CreateClient();
        using var response = await client.GetAsync(url);
        Assert.Equal(status, (int)response.StatusCode);
        await ProblemAssertions.AssertProblem(response, slug);
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.Equal("/api/slots", problem["instance"]!.GetValue<string>());
        Assert.Equal(detail, problem["detail"]!.GetValue<string>());
        Assert.Equal(hasErrors, problem.ContainsKey("errors"));
        if (hasErrors)
        {
            Assert.Equal("Параметр «meetingTypeId» обязателен.", problem["errors"]!["meetingTypeId"]![0]!.GetValue<string>());
        }
    }

    private static async Task<JsonNode> ReadSlotsAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/api/slots?meetingTypeId=contract-slots");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Null(response.Headers.Location);
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.True(Matches(OpenApiContract.Instance.ResponseSchema("/api/slots", "get", 200), body));
        return body;
    }

}
