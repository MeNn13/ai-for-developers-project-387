using BookingCalendar.Domain.ValueObjects;

namespace BookingCalendar.Domain.Rules;

// Чистые правила слота (спека #23, решения #4–#7): без DI, HTTP и хранилища.
// Время — по Москве (UTC+3): DST в Москве нет с 2014 года, смещение постоянно.
public static class SlotRules
{
    public const string TimeZoneId = "Europe/Moscow";
    public const int WindowDays = 14;
    public const int GridStepMinutes = 30;
    public const int GridStartsPerDay = 16;
    public const int GridStartHour = 10;
    public const int WorkdayEndHour = 18;

    public static TimeZoneInfo TimeZone { get; } = TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId);

    // Окно записи — сегодня и следующие 13 дней по московскому времени.
    public static DateOnly WindowStart(DateTimeOffset now) => LocalDate(now);

    public static DateOnly WindowEnd(DateTimeOffset now) => WindowStart(now).AddDays(WindowDays - 1);

    public static bool IsWorkingDay(DateOnly date) =>
        date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday);

    // Ограничения контракта: 15–480 минут, кратность 5.
    public static bool IsDurationAllowed(int durationMinutes) =>
        MeetingDuration.TryCreate(durationMinutes, out _) is not null;

    // Сетка стартов: 10:00 + 30 минут × k, k = 0…15, независимо от длительности.
    public static IReadOnlyList<DateTimeOffset> DayStarts(DateOnly date)
    {
        var starts = new DateTimeOffset[GridStartsPerDay];
        var gridStart = new TimeOnly(GridStartHour, 0);
        for (var index = 0; index < GridStartsPerDay; index++)
        {
            starts[index] = At(date, gridStart.AddMinutes(index * GridStepMinutes));
        }

        return starts;
    }

    // Слот бронируем, если он в рабочий день внутри окна, начинается в будущем,
    // лежит на сетке и успевает закончиться не позже 18:00.
    public static bool IsBookable(DateTimeOffset start, int durationMinutes, DateTimeOffset now)
    {
        if (!IsDurationAllowed(durationMinutes))
        {
            return false;
        }

        var date = LocalDate(start);
        if (!IsWorkingDay(date) || date < WindowStart(now) || date > WindowEnd(now))
        {
            return false;
        }

        if (start <= now || !DayStarts(date).Contains(start))
        {
            return false;
        }

        return EndsByWorkdayEnd(start, durationMinutes);
    }

    // Полуоткрытые интервалы [start, end): касание границ не считается пересечением.
    public static bool Overlaps(
        DateTimeOffset start,
        DateTimeOffset end,
        DateTimeOffset otherStart,
        DateTimeOffset otherEnd) =>
        start < otherEnd && otherStart < end;

    public static bool IsAvailable(
        DateTimeOffset start,
        DateTimeOffset end,
        IEnumerable<OccupiedInterval> meetings) =>
        !meetings.Any(meeting => Overlaps(start, end, meeting.Start, meeting.End));

    private static DateOnly LocalDate(DateTimeOffset value) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(value, TimeZone).DateTime);

    private static DateTimeOffset At(DateOnly date, TimeOnly time)
    {
        var wallClock = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        return new DateTimeOffset(wallClock, TimeZone.GetUtcOffset(wallClock));
    }

    private static bool EndsByWorkdayEnd(DateTimeOffset start, int durationMinutes)
    {
        var localStart = TimeZoneInfo.ConvertTime(start, TimeZone);
        var localEnd = TimeZoneInfo.ConvertTime(start.AddMinutes(durationMinutes), TimeZone);
        var workdayStart = TimeSpan.FromHours(GridStartHour);
        var workdayEnd = TimeSpan.FromHours(WorkdayEndHour);

        return localStart.TimeOfDay >= workdayStart
            && DateOnly.FromDateTime(localStart.DateTime) == DateOnly.FromDateTime(localEnd.DateTime)
            && localEnd.TimeOfDay <= workdayEnd;
    }
}
