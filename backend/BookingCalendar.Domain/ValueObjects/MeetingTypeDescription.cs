namespace BookingCalendar.Domain.ValueObjects;

public sealed record MeetingTypeDescription
{
    private MeetingTypeDescription(string value) => Value = value;

    public string Value { get; }

    public static MeetingTypeDescription? TryCreate(string value, out string? error)
    {
        ArgumentNullException.ThrowIfNull(value);
        error = value.Length > 500
            ? "Длина поля «Описание» должна быть не больше 500 символов."
            : null;
        return error is null ? new MeetingTypeDescription(value) : null;
    }
}
