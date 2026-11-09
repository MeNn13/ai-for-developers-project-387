using BookingCalendar.Domain.Aggregates;

namespace BookingCalendar.Application.State;

internal sealed class CalendarState
{
    internal Calendar Calendar { get; } = new();
    internal object Gate { get; } = new();
    internal List<MeetingType> MeetingTypes { get; } = [];
}
