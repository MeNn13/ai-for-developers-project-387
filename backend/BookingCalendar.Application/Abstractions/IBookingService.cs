using BookingCalendar.Domain.Aggregates;
namespace BookingCalendar.Application.Abstractions;

public interface IBookingService { BookingResult Book(string meetingTypeId, DateTimeOffset start, string guestName); }
