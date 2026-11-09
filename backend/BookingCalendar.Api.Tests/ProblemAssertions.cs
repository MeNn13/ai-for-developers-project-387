using System.Text.Json;

using Json.Schema;

namespace BookingCalendar.Api.Tests;

// Единая проверка ошибок ProblemDetails: application/problem+json, соответствие
// полной схеме операции и статуса, slug из enum контракта и совпадение status.
// Необъявленный маршрут проверяется по компоненту ProblemDetails.
internal static class ProblemAssertions
{
    public static async Task AssertProblem(HttpResponseMessage response, string slug)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        var request = response.RequestMessage!;
        var path = request.RequestUri!.AbsolutePath;
        var method = request.Method.Method.ToLowerInvariant();
        var schema = OpenApiContract.Instance.PathMethods.ContainsKey(path)
            ? OpenApiContract.Instance.ResponseSchema(path, method, (int)response.StatusCode)
            : OpenApiContract.Instance.ProblemSchema;
        var result = schema.Evaluate(
            root,
            new EvaluationOptions { OutputFormat = OutputFormat.List, RequireFormatValidation = true });
        Assert.True(
            result.IsValid,
            $"Тело ошибки не соответствует схеме ProblemDetails из контракта.\n{result}\n{body}");

        Assert.Equal(slug, root.GetProperty("type").GetString());
        Assert.Contains(slug, OpenApiContract.Instance.ProblemTypeSlugs);
        Assert.Equal((int)response.StatusCode, root.GetProperty("status").GetInt32());
        if (slug != "validation-failed")
        {
            Assert.False(root.TryGetProperty("errors", out _));
        }
    }
}
