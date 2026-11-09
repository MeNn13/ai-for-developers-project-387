using BookingCalendar.Domain.ValueObjects;

namespace BookingCalendar.Domain.Aggregates;

public sealed class MeetingType
{
    private MeetingType(MeetingTypeId id, MeetingTypeTitle title, MeetingTypeDescription description, MeetingDuration duration)
    {
        Id = id;
        Title = title;
        Description = description;
        Duration = duration;
    }

    public MeetingTypeId Id { get; }
    public MeetingTypeTitle Title { get; }
    public MeetingTypeDescription Description { get; }
    public MeetingDuration Duration { get; }

    public static MeetingType? TryCreate(string? id, string? title, string? description, int? durationMinutes,
        out IReadOnlyDictionary<string, string[]> errors)
    {
        var failures = new Dictionary<string, string[]>(StringComparer.Ordinal);
        string? idError = null;
        var validId = id is null ? null : MeetingTypeId.TryCreate(id, out idError);
        string? titleError = null;
        var validTitle = title is null ? null : MeetingTypeTitle.TryCreate(title, out titleError);
        string? descriptionError = null;
        var validDescription = description is null ? null : MeetingTypeDescription.TryCreate(description, out descriptionError);
        string? durationError = null;
        var validDuration = durationMinutes is null ? null : MeetingDuration.TryCreate(durationMinutes.Value, out durationError);
        if (idError is not null) { failures["id"] = [idError]; }
        if (titleError is not null) { failures["title"] = [titleError]; }
        if (descriptionError is not null) { failures["description"] = [descriptionError]; }
        if (durationError is not null) { failures["durationMinutes"] = [durationError]; }
        errors = failures;
        return validId is not null && validTitle is not null && validDescription is not null && validDuration is not null
            ? new MeetingType(validId, validTitle, validDescription, validDuration) : null;
    }
}
