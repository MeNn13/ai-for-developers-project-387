using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace BookingCalendar.Api.Tests;

public class MeetingTypeBoundaryTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [InlineData(64, 120, 500, 480)]
    [InlineData(1, 1, 0, 15)]
    public async Task CreatePreservesBoundaryValues(int idLength, int titleLength, int descriptionLength, int duration)
    {
        using var client = app.CreateClient();
        var payload = new
        {
            id = new string('b', idLength),
            title = new string(' ', titleLength),
            description = new string(' ', descriptionLength),
            durationMinutes = duration,
        };
        using var response = await client.PostAsJsonAsync("/api/meeting-types", payload);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(payload.id, document.RootElement.GetProperty("id").GetString());
        Assert.Equal(payload.title, document.RootElement.GetProperty("title").GetString());
        Assert.Equal(payload.description, document.RootElement.GetProperty("description").GetString());
        Assert.Equal(duration, document.RootElement.GetProperty("durationMinutes").GetInt32());
    }

    [Fact]
    public async Task InvalidStructureAndValuesReportAllErrorsWithoutSaving()
    {
        using var client = app.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/meeting-types", new
        {
            id = "invalid-structure",
            title = new string('t', 121),
            description = false,
            durationMinutes = 17,
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var errors = document.RootElement.GetProperty("errors");
        Assert.Equal("Длина поля «Название» должна быть от 1 до 120 символов.", errors.GetProperty("title")[0].GetString());
        Assert.Equal("Поле «Описание» должно быть строкой.", errors.GetProperty("description")[0].GetString());
        Assert.Equal("Длительность должна быть кратна 5 минутам.", errors.GetProperty("durationMinutes")[0].GetString());
        using var valid = await client.PostAsJsonAsync("/api/meeting-types", new
        {
            id = "invalid-structure",
            title = "Valid",
            description = "",
            durationMinutes = 30,
        });
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
    }
}
