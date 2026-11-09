using System.Net;
using System.Text;
using System.Text.Json;

using Json.Schema;

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace BookingCalendar.Api.Tests;

// Conformance «контракт <-> бэкенд» по contract/openapi/openapi.yaml.
// Прямое направление: каждая операция контракта с валидным примером из контракта
// отвечает не-404, а тело ответа проходит JSON-схему объявленного успеха.
// Обратное направление: маршруты /api приложения из EndpointDataSource совпадают
// с путями контракта (catch-all с ** в шаблонах не считается маршрутом контракта).
public class ContractConformanceTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [MemberData(nameof(ContractOperations))]
    public async Task EveryContractOperationAnswersAndMatchesSchema(string path, string method)
    {
        using var client = app.CreateClient();
        using var response = await SendOperationAsync(client, path, method);

        var status = (int)response.StatusCode;
        Assert.NotEqual((int)HttpStatusCode.NotFound, status);
        Assert.True(response.IsSuccessStatusCode, $"{method} {path} ответил {status}.");

        Assert.Contains(status, OpenApiContract.Instance.ResponseStatusCodes(path, method));
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var result = OpenApiContract.Instance.ResponseSchema(path, method, status)
            .Evaluate(document.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List, RequireFormatValidation = true });

        Assert.True(
            result.IsValid,
            $"Тело {method} {path} не соответствует схеме контракта.\n{result}\n{body}");
    }

    [Theory]
    [MemberData(nameof(ContractProblemResponses))]
    public async Task EveryDeclaredProblemStatusMatchesOperationSchema(string path, string method, int status)
    {
        using var client = app.CreateClient();
        using var response = await SendProblemOperationAsync(client, path, method, status);
        Assert.Equal(status, (int)response.StatusCode);
        var slug = (path, status) switch
        {
            (_, 400) => "validation-failed",
            (_, 404) => "meeting-type-not-found",
            ("/api/meeting-types", 409) => "meeting-type-exists",
            ("/api/meetings", 409) => "slot-taken",
            _ => throw new NotSupportedException($"Нет примера для {method} {path} {status}."),
        };
        await ProblemAssertions.AssertProblem(response, slug);
    }

    [Fact]
    public void ApplicationApiRoutesMatchContractPaths()
    {
        var dataSource = app.Services.GetRequiredService<EndpointDataSource>();

        var appRoutes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText!)
            .Where(template =>
                template.StartsWith("/api", StringComparison.Ordinal)
                && !template.Contains("**", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(template => template, StringComparer.Ordinal)
            .ToArray();

        string[] contractPaths = [.. OpenApiContract.Instance.PathMethods.Keys
            .OrderBy(path => path, StringComparer.Ordinal)];

        Assert.Equal(contractPaths, appRoutes);
    }

    public static TheoryData<string, string> ContractOperations
    {
        get
        {
            var data = new TheoryData<string, string>();
            foreach (var (path, methods) in OpenApiContract.Instance.PathMethods)
            {
                foreach (var method in methods)
                {
                    data.Add(path, method);
                }
            }

            return data;
        }
    }

    public static TheoryData<string, string, int> ContractProblemResponses
    {
        get
        {
            var data = new TheoryData<string, string, int>();
            foreach (var (path, methods) in OpenApiContract.Instance.PathMethods)
            {
                foreach (var method in methods)
                {
                    foreach (var status in OpenApiContract.Instance.ResponseStatusCodes(path, method).Where(status => status >= 400))
                    {
                        data.Add(path, method, status);
                    }
                }
            }

            return data;
        }
    }

    private static async Task<HttpResponseMessage> SendProblemOperationAsync(HttpClient client, string path, string method, int status)
    {
        if (method == "get" && path == "/api/slots")
        {
            return await client.GetAsync(status switch
            {
                400 => path,
                404 => path + "?meetingTypeId=conformance-missing",
                _ => throw new NotSupportedException($"Нет примера для {method} {path} {status}."),
            });
        }

        if (method == "post" && status == 400)
        {
            return await MeetingHttp.PostJsonAsync(client, path, "{}");
        }

        if (method == "post" && path == "/api/meetings" && status == 404)
        {
            return await MeetingHttp.CreateMeetingAsync(client, "conformance-missing", MeetingHttp.Moscow(6, 10, 0), "Анна");
        }

        if (method == "post" && status == 409)
        {
            var id = path == "/api/meeting-types" ? "conformance-duplicate" : "conformance-occupied";
            using var type = await MeetingHttp.CreateMeetingTypeAsync(client, id, "Конфликт", 30);
            type.EnsureSuccessStatusCode();
            if (path == "/api/meeting-types")
            {
                return await MeetingHttp.CreateMeetingTypeAsync(client, id, "Конфликт", 30);
            }

            if (path == "/api/meetings")
            {
                using var first = await MeetingHttp.CreateMeetingAsync(client, id, MeetingHttp.Moscow(6, 10, 0), "Анна");
                first.EnsureSuccessStatusCode();
                return await MeetingHttp.CreateMeetingAsync(client, id, MeetingHttp.Moscow(6, 10, 0), "Борис");
            }
        }

        throw new NotSupportedException($"Нет примера для {method} {path} {status}.");
    }

    private static async Task<HttpResponseMessage> SendOperationAsync(
        HttpClient client,
        string path,
        string method) => method switch
        {
            "get" => await client.GetAsync(await UrlWithRequiredParametersAsync(client, path)),
            "post" => await client.PostAsync(path, await ContractRequestContentAsync(client, path, method)),
            _ => throw new NotSupportedException($"Метод «{method}» не поддерживается тестом."),
        };

    // listSlots требует meetingTypeId: тип встречи готовится только публичным HTTP,
    // сид напрямую в хранилище через DI запрещён (спека #23, Testing Decisions #5).
    private static async Task<string> UrlWithRequiredParametersAsync(HttpClient client, string path)
    {
        if (path != "/api/slots")
        {
            return path;
        }

        using var content = new StringContent(
            """{"id":"conformance-slots","title":"Слоты","description":"","durationMinutes":30}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);
        response.EnsureSuccessStatusCode();

        return $"{path}?meetingTypeId=conformance-slots";
    }

    // Тело POST-запроса берётся из example схемы запроса в контракте.
    // Бронь ссылается на тип встречи, поэтому тип из примера создаётся публичным HTTP.
    private static async Task<StringContent> ContractRequestContentAsync(
        HttpClient client,
        string path,
        string method)
    {
        var schemaName = OpenApiContract.Instance.RequestSchemaName(path, method);
        var example = OpenApiContract.Instance.RequestExample(schemaName);

        if (path == "/api/meetings")
        {
            await EnsureMeetingTypeAsync(client, example["meetingTypeId"]!.GetValue<string>());
        }

        return new StringContent(example.ToJsonString(), Encoding.UTF8, "application/json");
    }

    private static async Task EnsureMeetingTypeAsync(HttpClient client, string id)
    {
        using var content = new StringContent(
            $$"""{"id":"{{id}}","title":"Знакомство","description":"","durationMinutes":30}""",
            Encoding.UTF8,
            "application/json");
        using var response = await client.PostAsync("/api/meeting-types", content);

        // 409 значит, что тип уже создан другой операцией того же прогона.
        Assert.True(
            response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict,
            $"Не удалось подготовить тип встречи {id}: {(int)response.StatusCode}.");
    }
}
