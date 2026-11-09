using BookingCalendar.Domain.Entities;
namespace BookingCalendar.Application.Abstractions;

public interface IMeetingService { IReadOnlyList<Meeting> ListUpcoming(); }
