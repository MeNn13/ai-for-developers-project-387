using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace BookingCalendar.Api.Tests;

// Единое приложение для HTTP-тестов: на нём живут поведенческие тесты и conformance.
// Часы подменяются через ConfigureTestServices: тест задаёт момент явно, поэтому
// результат не зависит от реального времени и часового пояса машины.
public sealed class TestApp : WebApplicationFactory<Program>
{
    private readonly TestClock _clock = new(
        new DateTimeOffset(2026, 11, 2, 8, 0, 0, TimeSpan.FromHours(3)));

    public void SetNow(DateTimeOffset now) => _clock.SetNow(now);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(_clock);
        });
    }

    // FakeTimeProvider не умеет переводить часы назад, а тесты класса делят один
    // экземпляр приложения; поэтому текущий FakeTimeProvider заменяется целиком.
    private sealed class TestClock(DateTimeOffset now) : TimeProvider
    {
        private FakeTimeProvider _current = new(now);

        public void SetNow(DateTimeOffset value) => _current = new FakeTimeProvider(value);

        public override DateTimeOffset GetUtcNow() => _current.GetUtcNow();
    }
}
