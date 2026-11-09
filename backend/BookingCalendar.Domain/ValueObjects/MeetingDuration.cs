namespace BookingCalendar.Domain.ValueObjects;

public sealed record MeetingDuration
{
    private MeetingDuration(int value) => Value = value;

    public int Value { get; }

    public static MeetingDuration? TryCreate(int value, out string? error)
    {
        error = value is < 15 or > 480
            ? "Длительность должна быть от 15 до 480 минут."
            : value % 5 != 0
                ? "Длительность должна быть кратна 5 минутам."
            : null;
        return error is null ? new MeetingDuration(value) : null;
    }
}
