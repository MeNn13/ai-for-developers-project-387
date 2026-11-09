using System.Net;
using System.Text.Json;

using BookingCalendar.Domain.Rules;

using Microsoft.AspNetCore.Http;

namespace BookingCalendar.Api.Tests;

// Доказательство атомарности из ADR 0001 и Testing Decisions #6: 10 одновременных
// POST на один старт, ровно один 201, девять 409 slot-taken, ни одного 500;
// финальный GET показывает ровно одну встречу этого раунда. 20 раундов, в каждом
// свежий тип встречи и свой старт. Без Thread.Sleep и Task.Delay.
public class BookingAtomicityTests(TestApp app) : IClassFixture<TestApp>
{
    private const int ParallelRequests = 10;
    private const int Rounds = 20;

    [Fact]
    public async Task ConcurrentBookingsOnOneSlotCreateExactlyOneMeeting()
    {
        app.SetNow(MeetingHttp.Moscow(2, 8, 0));
        using var client = app.CreateClient();

        for (var round = 0; round < Rounds; round++)
        {
            var typeId = $"race-{round}";
            using (var typeResponse = await MeetingHttp.CreateMeetingTypeAsync(client, typeId, "Гонка", 30))
            {
                typeResponse.EnsureSuccessStatusCode();
            }

            var start = RoundStart(round);
            var responses = await Task.WhenAll(Enumerable.Range(0, ParallelRequests)
                .Select(_ => MeetingHttp.CreateMeetingAsync(client, typeId, start, "Гонка")));

            try
            {
                var statuses = responses.Select(response => (int)response.StatusCode).ToArray();
                Assert.Equal(1, statuses.Count(status => status == StatusCodes.Status201Created));
                Assert.Equal(
                    ParallelRequests - 1,
                    statuses.Count(status => status == StatusCodes.Status409Conflict));
                Assert.DoesNotContain(StatusCodes.Status500InternalServerError, statuses);

                foreach (var conflict in responses.Where(response =>
                    response.StatusCode == HttpStatusCode.Conflict))
                {
                    await ProblemAssertions.AssertProblem(conflict, "slot-taken");
                }

                var meetings = await ListMeetingsAsync(client);
                Assert.Single(meetings, meeting =>
                    meeting.GetProperty("meetingTypeId").GetString() == typeId);
                Assert.Equal(round + 1, meetings.Count);
            }
            finally
            {
                foreach (var response in responses)
                {
                    response.Dispose();
                }
            }
        }
    }

    // Старты идут по сетке: 16 стартов в день, дальше следующий рабочий день.
    private static DateTimeOffset RoundStart(int round)
    {
        var day = 2 + (round / SlotRules.GridStartsPerDay);
        var minutesFromStart = (round % SlotRules.GridStartsPerDay) * SlotRules.GridStepMinutes;
        return MeetingHttp.Moscow(
            day,
            SlotRules.GridStartHour + (minutesFromStart / 60),
            minutesFromStart % 60);
    }

    private static async Task<IReadOnlyList<JsonElement>> ListMeetingsAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/api/meetings");
        response.EnsureSuccessStatusCode();

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return [.. document.RootElement.EnumerateArray().Select(meeting => meeting.Clone())];
    }
}
