using BookingCalendar.Domain.Aggregates;
namespace BookingCalendar.Domain.Entities;

public sealed class Meeting
{
    internal Meeting(MeetingType type, DateTimeOffset start, string guestName)
    { Id = Guid.NewGuid(); MeetingTypeId = type.Id.Value; MeetingTypeTitle = type.Title.Value; DurationMinutes = type.Duration.Value; Start = start; End = start.AddMinutes(DurationMinutes); GuestName = guestName; }
    public Guid Id { get; }
    public string MeetingTypeId { get; }
    public string MeetingTypeTitle { get; }
    public int DurationMinutes { get; }
    public DateTimeOffset Start { get; }
    public DateTimeOffset End { get; }
    public string GuestName { get; }
}
