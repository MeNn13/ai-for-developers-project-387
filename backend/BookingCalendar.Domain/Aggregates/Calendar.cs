using BookingCalendar.Domain.Entities;
using BookingCalendar.Domain.Rules;
using BookingCalendar.Domain.ValueObjects;
namespace BookingCalendar.Domain.Aggregates;

public enum BookingOutcome { Created, MeetingTypeNotFound, SlotNotBookable, SlotTaken, InvalidGuestName }
public readonly record struct BookingResult(BookingOutcome Outcome, Meeting? Meeting);
public sealed class Calendar
{
    private readonly List<Meeting> _meetings = [];
    public IReadOnlyList<Meeting> Meetings => _meetings.AsReadOnly();
    public BookingResult Book(MeetingType type, DateTimeOffset start, string guestName, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(type);
        if (GuestName.TryCreate(guestName, out _) is null) { return new(BookingOutcome.InvalidGuestName, null); }
        if (!SlotRules.IsBookable(start, type.Duration.Value, now)) { return new(BookingOutcome.SlotNotBookable, null); }
        var end = start.AddMinutes(type.Duration.Value);
        if (_meetings.Any(existing => SlotRules.Overlaps(start, end, existing.Start, existing.End))) { return new(BookingOutcome.SlotTaken, null); }
        var meeting = new Meeting(type, start, guestName);
        _meetings.Add(meeting);
        return new(BookingOutcome.Created, meeting);
    }
}
