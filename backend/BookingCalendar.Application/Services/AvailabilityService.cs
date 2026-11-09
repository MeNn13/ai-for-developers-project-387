using BookingCalendar.Application.Abstractions;
using BookingCalendar.Application.State;
using BookingCalendar.Domain.Rules;

namespace BookingCalendar.Application.Services;

internal sealed class AvailabilityService(CalendarState state, TimeProvider timeProvider) : IAvailabilityService
{
    public Availability? List(string meetingTypeId)
    {
        int duration;
        DateTimeOffset now;
        OccupiedInterval[] occupied;
        lock (state.Gate)
        {
            var type = state.MeetingTypes.Find(type => string.Equals(type.Id.Value, meetingTypeId, StringComparison.Ordinal));
            if (type is null) { return null; }
            duration = type.Duration.Value;
            now = timeProvider.GetUtcNow();
            occupied = state.Calendar.Meetings.Select(meeting => new OccupiedInterval(meeting.Start, meeting.End)).ToArray();
        }

        var from = SlotRules.WindowStart(now);
        var days = new List<AvailabilityDay>(SlotRules.WindowDays);
        for (var offset = 0; offset < SlotRules.WindowDays; offset++)
        {
            var date = from.AddDays(offset);
            var slots = SlotRules.DayStarts(date)
                .Where(start => SlotRules.IsBookable(start, duration, now))
                .Select(start => new AvailabilitySlot(start, start.AddMinutes(duration),
                    SlotRules.IsAvailable(start, start.AddMinutes(duration), occupied)))
                .ToArray();
            days.Add(new(date, slots));
        }

        return new(SlotRules.TimeZoneId, from, SlotRules.WindowEnd(now), days);
    }
}
