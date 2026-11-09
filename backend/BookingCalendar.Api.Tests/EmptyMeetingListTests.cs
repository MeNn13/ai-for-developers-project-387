using System.Net;

namespace BookingCalendar.Api.Tests;

// Отдельный класс: пустой список проверяется на свежем хранилище, без встреч
// из других тестов (у каждого класса свой TestApp).
public class EmptyMeetingListTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task ListMeetingsReturnsEmptyArrayWhenThereAreNoMeetings()
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/api/meetings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("[]", await response.Content.ReadAsStringAsync());
    }
}
