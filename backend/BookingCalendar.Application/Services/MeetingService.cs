using BookingCalendar.Application.Abstractions;
using BookingCalendar.Application.State;
using BookingCalendar.Domain.Entities;
namespace BookingCalendar.Application.Services;

internal sealed class MeetingService(CalendarState state, TimeProvider timeProvider) : IMeetingService
{
    public IReadOnlyList<Meeting> ListUpcoming()
    {
        lock (state.Gate)
        {
            var now = timeProvider.GetUtcNow();
            return [.. state.Calendar.Meetings.Where(meeting => meeting.End > now).OrderBy(meeting => meeting.Start)];
        }
    }
}
