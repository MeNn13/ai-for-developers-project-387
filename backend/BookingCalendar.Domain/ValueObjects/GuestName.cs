namespace BookingCalendar.Domain.ValueObjects;

public sealed record GuestName
{
    private GuestName(string value) { Value = value; }
    public string Value { get; }
    public static GuestName? TryCreate(string? value, out string? error)
    {
        error = value is null || value.Length is < 1 or > 100 ? "Длина поля «Ваше имя» должна быть от 1 до 100 символов." : null;
        return error is null ? new GuestName(value!) : null;
    }
}
