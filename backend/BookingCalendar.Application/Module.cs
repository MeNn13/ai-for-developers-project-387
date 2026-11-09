using BookingCalendar.Application.Abstractions;
using BookingCalendar.Application.Services;
using BookingCalendar.Application.State;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BookingCalendar.Application;

// Соглашение проекта: модули называются Module и различаются namespace и методами.
// Исключение согласовано владельцем; пересмотр: 2027-04-30.
#pragma warning disable CA1716
public static class Module
{
    public static IServiceCollection AddBookingCalendarApplication(this IServiceCollection services)
    {
        services.AddSingleton<CalendarState>();
        services.AddScoped<IMeetingTypeService, MeetingTypeService>();
        services.AddScoped<IBookingService, BookingService>();
        services.AddScoped<IMeetingService, MeetingService>();
        services.AddScoped<IAvailabilityService, AvailabilityService>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }
}
#pragma warning restore CA1716
