namespace BookingCalendar.Domain.ValueObjects;

public sealed record MeetingTypeId
{
    private MeetingTypeId(string value) => Value = value;

    public string Value { get; }

    public static MeetingTypeId? TryCreate(string value, out string? error)
    {
        ArgumentNullException.ThrowIfNull(value);
        error = value.Length is < 1 or > 64
            ? "Длина поля «Идентификатор» должна быть от 1 до 64 символов."
            : !value.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9' or '-')
                ? "Поле «Идентификатор» может содержать только строчные латинские буквы, цифры и дефис."
            : null;
        return error is null ? new MeetingTypeId(value) : null;
    }
}
