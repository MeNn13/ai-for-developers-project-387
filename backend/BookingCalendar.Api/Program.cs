using BookingCalendar.Api.Endpoints;
using BookingCalendar.Api.Http;
using BookingCalendar.Application;

using HealthResponse = BookingCalendar.HealthResponse;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddBookingCalendarApplication();

var app = builder.Build();

// In the container the built frontend is copied into wwwroot, so one process
// serves both the API and the pages. In development the folder does not exist
// and Vite serves the frontend instead.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapOpenApi();

app.MapGet("/api/health", () => new HealthResponse());

app.MapMeetingTypeEndpoints();
app.MapSlotEndpoints();
app.MapMeetingEndpoints();

// An unknown API route answers 404 with a ProblemDetails body instead of falling
// through to the SPA fallback below, which would return HTML with 200.
app.Map("/api/{**rest}", (HttpRequest request) => Problems.NotFound(request.Path.ToString()));

// Deep links to the SPA (/book, /owner) have no file on disk, so the fallback
// returns index.html and the router takes over.
app.MapFallbackToFile("index.html");

app.Run();

#pragma warning disable CA1050 // Program остаётся в глобальном namespace для WebApplicationFactory.
public partial class Program { }
#pragma warning restore CA1050
