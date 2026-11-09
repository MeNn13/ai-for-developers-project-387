namespace BookingCalendar.Application.Abstractions;

public interface IAvailabilityService
{
    Availability? List(string meetingTypeId);
}

public sealed record Availability(string Timezone, DateOnly From, DateOnly To, IReadOnlyList<AvailabilityDay> Days);
public sealed record AvailabilityDay(DateOnly Date, IReadOnlyList<AvailabilitySlot> Slots);
public sealed record AvailabilitySlot(DateTimeOffset Start, DateTimeOffset End, bool Available);
