using BookingCalendar.Domain.Aggregates;

namespace BookingCalendar.Application.Abstractions;

public interface IMeetingTypeService
{
    IReadOnlyList<MeetingType> List();
    CreateMeetingTypeResult Create(string? id, string? title, string? description, int? durationMinutes);
}

public sealed record CreateMeetingTypeResult(MeetingType? MeetingType, bool AlreadyExists, IReadOnlyDictionary<string, string[]> Errors);
