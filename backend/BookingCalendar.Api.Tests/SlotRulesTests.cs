using BookingCalendar.Domain.Rules;

namespace BookingCalendar.Api.Tests;

// Unit-матрица чистых правил слота (спека #23, Testing Decisions #4).
// DST не тестируется: в Москве перевода часов нет с 2014 года, смещение
// постоянно +03:00, поэтому отдельного сценария перехода не существует.
public class SlotRulesTests
{
    // Окно в тестах начинается во вторник 2026-11-03: тогда 13-й день окна —
    // понедельник, и проверка границы окна не пересекается с проверкой выходных.
    private static readonly DateTimeOffset s_now = At(0, 8, 0);

    [Theory]
    [InlineData(9, 30, false)]
    [InlineData(10, 0, true)]
    [InlineData(17, 30, true)]
    [InlineData(18, 0, false)]
    public void SlotMustStartWithinWorkingHours(int hour, int minute, bool expected)
    {
        var start = At(0, hour, minute);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes: 30, s_now));
    }

    [Theory]
    [InlineData(17, 30, 30, true)]
    [InlineData(17, 30, 35, false)]
    [InlineData(17, 0, 60, true)]
    public void SlotMustEndByWorkdayEnd(int hour, int minute, int durationMinutes, bool expected)
    {
        var start = At(0, hour, minute);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes, s_now));
    }

    [Theory]
    [InlineData(10, 0, true)]
    [InlineData(10, 30, true)]
    [InlineData(10, 15, false)]
    public void SlotMustStartOnTheGrid(int hour, int minute, bool expected)
    {
        var start = At(0, hour, minute);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes: 30, s_now));
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(13, true)]
    [InlineData(14, false)]
    public void SlotMustStayWithinTheBookingWindow(int dayOffset, bool expected)
    {
        var start = At(dayOffset, 10, 0);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes: 30, s_now));
    }

    [Theory]
    [InlineData(4, false)]
    [InlineData(5, false)]
    [InlineData(6, true)]
    public void SlotMustStartOnAWorkingDay(int dayOffset, bool expected)
    {
        var start = At(dayOffset, 10, 0);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes: 30, s_now));
    }

    [Theory]
    [InlineData(10, 0, false)]
    [InlineData(9, 59, true)]
    public void SlotMustStartStrictlyAfterNow(int nowHour, int nowMinute, bool expected)
    {
        var start = At(0, 10, 0);
        var now = At(0, nowHour, nowMinute);

        Assert.Equal(expected, SlotRules.IsBookable(start, durationMinutes: 30, now));
    }

    [Theory]
    [InlineData(9, 45, 10, 15, true)]
    [InlineData(10, 15, 10, 45, true)]
    [InlineData(9, 0, 11, 0, true)]
    [InlineData(10, 0, 10, 30, true)]
    [InlineData(9, 30, 10, 0, false)]
    [InlineData(10, 30, 11, 0, false)]
    public void OverlapUsesHalfOpenIntervals(
        int meetingHour,
        int meetingMinute,
        int meetingEndHour,
        int meetingEndMinute,
        bool expected)
    {
        var slotStart = At(0, 10, 0);
        var slotEnd = At(0, 10, 30);
        var meetingStart = At(0, meetingHour, meetingMinute);
        var meetingEnd = At(0, meetingEndHour, meetingEndMinute);

        Assert.Equal(expected, SlotRules.Overlaps(slotStart, slotEnd, meetingStart, meetingEnd));
    }

    [Theory]
    [InlineData(15, true)]
    [InlineData(30, true)]
    [InlineData(480, true)]
    [InlineData(0, false)]
    [InlineData(10, false)]
    [InlineData(485, false)]
    public void DurationMustMatchTheContractConstraints(int durationMinutes, bool expected)
    {
        Assert.Equal(expected, SlotRules.IsDurationAllowed(durationMinutes));
    }

    [Fact]
    public void DaySlotsAreUnavailableOnlyWhenTheyOverlapAMeeting()
    {
        var day = new DateOnly(2026, 11, 3);
        var meetings = new[]
        {
            // Встреча кончается ровно в 10:00 и не занимает слот 10:00–10:30.
            new OccupiedInterval(At(0, 9, 30), At(0, 10, 0)),
            // Встреча ровно совпадает со слотом 10:30–11:00.
            new OccupiedInterval(At(0, 10, 30), At(0, 11, 0)),
        };

        var result = SlotRules.DayStarts(day).Select(start => SlotRules.IsAvailable(start, start.AddMinutes(30), meetings)).ToArray();

        Assert.Equal(16, result.Length);
        Assert.True(result[0]);
        Assert.False(result[1]);
        Assert.True(result[2]);
        Assert.All(result.Skip(2), available => Assert.True(available));
    }

    private static DateTimeOffset At(int dayOffset, int hour, int minute) =>
        new(
            new DateTime(2026, 11, 3, 0, 0, 0, DateTimeKind.Unspecified)
                .AddDays(dayOffset)
                .AddHours(hour)
                .AddMinutes(minute),
            TimeSpan.FromHours(3));
}
