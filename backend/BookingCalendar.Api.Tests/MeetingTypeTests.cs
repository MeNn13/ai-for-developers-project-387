using System.Net;
using System.Text;
using System.Text.Json;

namespace BookingCalendar.Api.Tests;

public class MeetingTypeTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task CreateMeetingTypeReturnsCreatedType()
    {
        using var client = app.CreateClient();

        using var content = new StringContent(
            """
            {"id":"znakomstvo","title":"Знакомство","description":"Короткий первый созвон.","durationMinutes":30}
            """,
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Null(response.Headers.Location);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.Equal("znakomstvo", root.GetProperty("id").GetString());
        Assert.Equal("Знакомство", root.GetProperty("title").GetString());
        Assert.Equal("Короткий первый созвон.", root.GetProperty("description").GetString());
        Assert.Equal(30, root.GetProperty("durationMinutes").GetInt32());
    }

    [Fact]
    public async Task ListMeetingTypesReturnsTypesInCreationOrder()
    {
        using var client = app.CreateClient();

        await CreateMeetingTypeAsync(client, "order-first", "Первый тип");
        await CreateMeetingTypeAsync(client, "order-second", "Второй тип");

        using var response = await client.GetAsync("/api/meeting-types");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var ids = document.RootElement
            .EnumerateArray()
            .Select(type => type.GetProperty("id").GetString())
            .ToList();

        Assert.Contains("order-first", ids);
        Assert.Contains("order-second", ids);
        Assert.True(
            ids.IndexOf("order-first") < ids.IndexOf("order-second"),
            "Новый тип встречи должен появляться в конце списка.");
    }

    [Fact]
    public async Task CreateMeetingTypeRejectsDuplicateId()
    {
        using var client = app.CreateClient();

        await CreateMeetingTypeAsync(client, "dubl-id", "Первый тип");

        using var content = new StringContent(
            """{"id":"dubl-id","title":"Дубликат","description":"","durationMinutes":60}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "meeting-type-exists");
    }

    [Theory]
    [InlineData("""{"id":"Знакомство","title":"","durationMinutes":30}""")]
    [InlineData("""{"id":"multiple-check","title":"Проверка","description":"ок","durationMinutes":17}""")]
    [InlineData("""{"id":"min-check","title":"Проверка","description":"ок","durationMinutes":10}""")]
    [InlineData("""{"id":"max-check","title":"Проверка","description":"ок","durationMinutes":485}""")]
    [InlineData("""{"id":"","title":"Проверка","description":"ок","durationMinutes":30}""")]
    [InlineData("тело не JSON")]
    public async Task CreateMeetingTypeRejectsInvalidPayload(string body)
    {
        using var client = app.CreateClient();

        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");
    }

    [Fact]
    public async Task CreateMeetingTypeReportsFieldErrorsInMap()
    {
        using var client = app.CreateClient();

        using var content = new StringContent(
            """{"id":"Знакомство","title":"","durationMinutes":30}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "validation-failed");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var errors = document.RootElement.GetProperty("errors");

        foreach (var field in new[] { "id", "title", "description" })
        {
            Assert.True(
                errors.TryGetProperty(field, out var messages),
                $"Ожидалась ошибка по полю «{field}», а errors = {errors.GetRawText()}");
            Assert.NotEmpty(messages.EnumerateArray());
        }
    }

    [Fact]
    public async Task CreateMeetingTypeAcceptsIdWithLeadingAndTrailingHyphen()
    {
        using var client = app.CreateClient();

        using var content = new StringContent(
            """{"id":"-intro-","title":"Intro","description":"","durationMinutes":15}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task CreateMeetingTypeAsync(
        HttpClient client,
        string id,
        string title)
    {
        using var content = new StringContent(
            $$"""{"id":"{{id}}","title":"{{title}}","description":"","durationMinutes":30}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        response.EnsureSuccessStatusCode();
    }
}
