using System.Net;
using System.Text.Json;

using Json.Schema;

namespace BookingCalendar.Api.Tests;

public class HealthSmokeTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task HealthReturnsOk()
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/api/health");
        response.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ok", document.RootElement.GetProperty("status").GetString());
        Assert.Single(document.RootElement.EnumerateObject());
        var schema = OpenApiContract.Instance.ResponseSchema("/api/health", "get", 200);
        Assert.True(schema.Evaluate(document.RootElement,
            new EvaluationOptions { RequireFormatValidation = true }).IsValid);
    }
}
