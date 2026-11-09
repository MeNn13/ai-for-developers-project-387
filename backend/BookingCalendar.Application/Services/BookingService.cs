using BookingCalendar.Application.Abstractions;
using BookingCalendar.Application.State;
using BookingCalendar.Domain.Aggregates;
namespace BookingCalendar.Application.Services;

internal sealed class BookingService(CalendarState state, TimeProvider timeProvider) : IBookingService
{
    public BookingResult Book(string meetingTypeId, DateTimeOffset start, string guestName)
    {
        lock (state.Gate)
        {
            var now = timeProvider.GetUtcNow();
            var type = state.MeetingTypes.Find(type => string.Equals(type.Id.Value, meetingTypeId, StringComparison.Ordinal));
            return type is null ? new(BookingOutcome.MeetingTypeNotFound, null) : state.Calendar.Book(type, start, guestName, now);
        }
    }
}
