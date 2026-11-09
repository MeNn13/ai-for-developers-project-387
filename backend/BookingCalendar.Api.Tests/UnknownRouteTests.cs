using System.Net;

namespace BookingCalendar.Api.Tests;

public class UnknownRouteTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task UnknownApiRouteReturnsNotFoundProblem()
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/api/missing");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await ProblemAssertions.AssertProblem(response, "not-found");
    }
}
