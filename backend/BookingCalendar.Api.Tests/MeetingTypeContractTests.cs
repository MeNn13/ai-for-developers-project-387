using System.Net;
using System.Text;
using System.Text.Json.Nodes;

using static BookingCalendar.Api.Tests.OpenApiContract;

namespace BookingCalendar.Api.Tests;

public class MeetingTypeContractTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [InlineData("id", "missing")]
    [InlineData("title", "missing")]
    [InlineData("description", "missing")]
    [InlineData("durationMinutes", "missing")]
    [InlineData("id", "null")]
    [InlineData("title", "null")]
    [InlineData("description", "null")]
    [InlineData("durationMinutes", "null")]
    [InlineData("id", "42")]
    [InlineData("title", "false")]
    [InlineData("description", "[]")]
    [InlineData("durationMinutes", "\"30\"")]
    public async Task InvalidRequiredFieldKeepsContractProblem(string field, string replacement)
    {
        var payload = OpenApiContract.Instance.RequestExample("MeetingTypeCreateRequest");
        if (replacement == "missing")
        {
            payload.AsObject().Remove(field);
        }
        else
        {
            payload[field] = JsonNode.Parse(replacement);
        }

        Assert.False(Matches(OpenApiContract.Instance.RequestSchema("/api/meeting-types", "post"), payload));
        using var client = app.CreateClient();
        using var content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.Equal("/api/meeting-types", problem["instance"]!.GetValue<string>());
        Assert.Equal("Проверьте правильность заполнения полей.", problem["detail"]!.GetValue<string>());
        Assert.NotEmpty(problem["errors"]![field]!.AsArray());
    }

    [Fact]
    public async Task ValidRequestWithExtraFieldCreatesUnwrappedTypeAndNonemptyList()
    {
        var payload = OpenApiContract.Instance.RequestExample("MeetingTypeCreateRequest");
        payload["id"] = "contract-extra";
        payload["extra"] = new JsonObject { ["ignored"] = true };
        Assert.True(Matches(OpenApiContract.Instance.RequestSchema("/api/meeting-types", "post"), payload));
        using var client = app.CreateClient();
        using var content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        using var created = await client.PostAsync("/api/meeting-types", content);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Null(created.Headers.Location);
        var body = JsonNode.Parse(await created.Content.ReadAsStringAsync())!;
        var schema = OpenApiContract.Instance.ResponseSchema("/api/meeting-types", "post", 201);
        Assert.True(Matches(schema, body));
        Assert.Equal("contract-extra", body["id"]!.GetValue<string>());
        Assert.False(Matches(schema, new JsonObject { ["body"] = body.DeepClone(), ["statusCode"] = 201 }));
        using var listed = await client.GetAsync("/api/meeting-types");
        var list = JsonNode.Parse(await listed.Content.ReadAsStringAsync())!;
        Assert.True(Matches(OpenApiContract.Instance.ResponseSchema("/api/meeting-types", "get", 200), list));
        Assert.Contains(list.AsArray(), item => item!["id"]!.GetValue<string>() == "contract-extra");
    }

    [Fact]
    public async Task ProblemSchemaRejectsUnknownEnumAndNonStringErrorMessages()
    {
        using var client = app.CreateClient();
        using var content = new StringContent("{}", Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        var schema = OpenApiContract.Instance.ResponseSchema("/api/meeting-types", "post", (int)response.StatusCode);
        var unknown = body.DeepClone();
        unknown["type"] = "unknown-error";
        Assert.False(Matches(schema, unknown));
        var wrongErrors = body.DeepClone();
        wrongErrors["errors"] = new JsonObject { ["id"] = new JsonArray(42) };
        Assert.False(Matches(schema, wrongErrors));
        Assert.False(Matches(schema, new JsonObject { ["body"] = body.DeepClone(), ["statusCode"] = 400 }));
        var alternatives = OpenApiContract.Instance.ResponseSchema("/api/meetings", "post", 400);
        Assert.True(Matches(alternatives, body));
        Assert.False(Matches(alternatives, unknown));
        Assert.False(Matches(alternatives, wrongErrors));
    }

    [Theory]
    [InlineData("{", "Тело запроса не является корректным JSON.")]
    [InlineData("null", "Тело запроса должно быть JSON-объектом.")]
    public async Task InvalidJsonStructureOmitsFieldErrors(string json, string detail)
    {
        using var client = app.CreateClient();
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
        var problem = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.Equal(detail, problem["detail"]!.GetValue<string>());
        Assert.Equal("/api/meeting-types", problem["instance"]!.GetValue<string>());
        Assert.False(problem.ContainsKey("errors"));
    }

}
