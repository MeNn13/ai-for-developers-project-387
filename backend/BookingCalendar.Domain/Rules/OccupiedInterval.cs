namespace BookingCalendar.Domain.Rules;

// Занятый интервал встречи: полуоткрытый [Start, End) по ADR 0001.
public readonly record struct OccupiedInterval(DateTimeOffset Start, DateTimeOffset End);
