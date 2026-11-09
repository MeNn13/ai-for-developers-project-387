using System.Net;
using System.Text.Json.Nodes;

using static BookingCalendar.Api.Tests.OpenApiContract;

namespace BookingCalendar.Api.Tests;

public class MeetingContractTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [InlineData("meetingTypeId", "missing")]
    [InlineData("start", "missing")]
    [InlineData("guestName", "missing")]
    [InlineData("meetingTypeId", "null")]
    [InlineData("start", "null")]
    [InlineData("guestName", "null")]
    [InlineData("meetingTypeId", "42")]
    [InlineData("start", "false")]
    [InlineData("guestName", "[]")]
    [InlineData("start", "\"2026-11-02\"")]
    [InlineData("start", "\"2026-11-02T10:00:00\"")]
    [InlineData("start", "\"2026-02-30T10:00:00+03:00\"")]
    [InlineData("start", "\"2026-11-02T10:00:00+25:00\"")]
    public async Task InvalidRequestPreservesFieldProblem(string field, string replacement)
    {
        var payload = OpenApiContract.Instance.RequestExample("MeetingCreateRequest");
        if (replacement == "missing")
        {
            payload.AsObject().Remove(field);
        }
        else
        {
            payload[field] = JsonNode.Parse(replacement);
        }

        Assert.False(Matches(OpenApiContract.Instance.RequestSchema("/api/meetings", "post"), payload));
        using var client = app.CreateClient();
        using var response = await MeetingHttp.PostJsonAsync(client, "/api/meetings", payload.ToJsonString());
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.Equal("/api/meetings", problem["instance"]!.GetValue<string>());
        Assert.Equal("Проверьте правильность заполнения полей.", problem["detail"]!.GetValue<string>());
        Assert.NotEmpty(problem["errors"]![field]!.AsArray());
    }

    [Theory]
    [InlineData("2026-11-02T07:00:00Z", "2026-11-02", true)]
    [InlineData("2026-11-03T10:00:00+03:00", "2026-11-03", true)]
    [InlineData("2026-11-04T11:00:00+0400", "2026-11-04", false)]
    public async Task OffsetAndExtraFieldPreserveCreatedBodyAndList(string start, string day, bool matchesRequestSchema)
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();
        var typeId = $"contract-{day}";
        using var type = await MeetingHttp.CreateMeetingTypeAsync(client, typeId, "Встреча", 30);
        type.EnsureSuccessStatusCode();
        var payload = new JsonObject
        {
            ["meetingTypeId"] = typeId,
            ["start"] = start,
            ["guestName"] = "Анна",
            ["extra"] = new JsonObject { ["ignored"] = true },
        };
        Assert.Equal(matchesRequestSchema, Matches(OpenApiContract.Instance.RequestSchema("/api/meetings", "post"), payload));
        using var created = await MeetingHttp.PostJsonAsync(client, "/api/meetings", payload.ToJsonString());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Null(created.Headers.Location);
        Assert.Equal("application/json", created.Content.Headers.ContentType?.MediaType);
        var body = JsonNode.Parse(await created.Content.ReadAsStringAsync())!;
        var schema = OpenApiContract.Instance.ResponseSchema("/api/meetings", "post", 201);
        Assert.True(Matches(schema, body));
        Assert.True(Guid.TryParse(body["id"]!.GetValue<string>(), out var id));
        Assert.NotEqual(Guid.Empty, id);
        Assert.Equal(typeId, body["meetingTypeId"]!.GetValue<string>());
        Assert.Equal($"{day}T10:00:00+03:00", body["start"]!.GetValue<string>());
        Assert.Equal($"{day}T10:30:00+03:00", body["end"]!.GetValue<string>());
        var invalidId = body.DeepClone();
        invalidId["id"] = "not-a-uuid";
        Assert.False(Matches(schema, invalidId));
        var invalidDate = body.DeepClone();
        invalidDate["start"] = "2026-11-02";
        Assert.False(Matches(schema, invalidDate));
        Assert.False(Matches(schema, new JsonObject { ["body"] = body.DeepClone(), ["statusCode"] = 201 }));
        using var listed = await client.GetAsync("/api/meetings");
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        var list = JsonNode.Parse(await listed.Content.ReadAsStringAsync())!;
        Assert.True(Matches(OpenApiContract.Instance.ResponseSchema("/api/meetings", "get", 200), list));
        var meeting = Assert.Single(list.AsArray(), item => item!["id"]!.GetValue<string>() == id.ToString("D"));
        Assert.True(JsonNode.DeepEquals(body, meeting));
    }

    [Theory]
    [InlineData("{", "Тело запроса не является корректным JSON.")]
    [InlineData("null", "Тело запроса должно быть JSON-объектом.")]
    public async Task InvalidJsonStructureOmitsFieldErrors(string json, string detail)
    {
        using var client = app.CreateClient();
        using var response = await MeetingHttp.PostJsonAsync(client, "/api/meetings", json);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.Equal(detail, problem["detail"]!.GetValue<string>());
        Assert.Equal("/api/meetings", problem["instance"]!.GetValue<string>());
        Assert.False(problem.ContainsKey("errors"));
    }

}
