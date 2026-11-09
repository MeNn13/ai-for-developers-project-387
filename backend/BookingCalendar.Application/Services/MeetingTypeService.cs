using BookingCalendar.Application.Abstractions;
using BookingCalendar.Application.State;
using BookingCalendar.Domain.Aggregates;

namespace BookingCalendar.Application.Services;

internal sealed class MeetingTypeService(CalendarState state) : IMeetingTypeService
{
    public IReadOnlyList<MeetingType> List()
    {
        lock (state.Gate) { return [.. state.MeetingTypes]; }
    }

    public CreateMeetingTypeResult Create(string? id, string? title, string? description, int? durationMinutes)
    {
        var meetingType = MeetingType.TryCreate(id, title, description, durationMinutes, out var errors);
        if (meetingType is null) { return new(null, false, errors); }
        lock (state.Gate)
        {
            if (state.MeetingTypes.Any(existing => existing.Id == meetingType.Id)) { return new(null, true, errors); }
            state.MeetingTypes.Add(meetingType);
            return new(meetingType, false, errors);
        }
    }
}
