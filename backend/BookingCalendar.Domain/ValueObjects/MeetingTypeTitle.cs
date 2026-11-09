namespace BookingCalendar.Domain.ValueObjects;

public sealed record MeetingTypeTitle
{
    private MeetingTypeTitle(string value) => Value = value;

    public string Value { get; }

    public static MeetingTypeTitle? TryCreate(string value, out string? error)
    {
        ArgumentNullException.ThrowIfNull(value);
        error = value.Length is < 1 or > 120
            ? "Длина поля «Название» должна быть от 1 до 120 символов."
            : null;
        return error is null ? new MeetingTypeTitle(value) : null;
    }
}
