using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

using Json.Schema;

using YamlDotNet.RepresentationModel;

namespace BookingCalendar.Api.Tests;

// Читает контракт contract/openapi/openapi.yaml: находит корень репозитория
// подъёмом вверх от каталога сборки тестов, конвертирует схемы OpenAPI 3.0
// в JSON Schema и компилирует их JsonSchema.Net для проверки ответов бэкенда.
internal sealed class OpenApiContract
{
    private const string JsonSchemaVersion = "https://json-schema.org/draft/2020-12/schema";

    private readonly JsonNode _document;

    private OpenApiContract(JsonNode document)
    {
        _document = document;
        PathMethods = ReadPathMethods(document);
        ProblemTypeSlugs = [.. Property("ProblemDetails", "type")["enum"]!.AsArray()
            .Select(value => value!.GetValue<string>())];
    }

    public static OpenApiContract Instance { get; } = Load();

    // Пути контракта и их методы: "/api/health" -> ["get"].
    public IReadOnlyDictionary<string, IReadOnlyList<string>> PathMethods { get; }

    // Slug'и ошибок из enum поля type схемы ProblemDetails.
    public IReadOnlyList<string> ProblemTypeSlugs { get; }

    public IReadOnlyList<int> ResponseStatusCodes(string path, string method) =>
        [.. Operation(path, method)["responses"]!.AsObject()
            .Select(pair => int.Parse(pair.Key, CultureInfo.InvariantCulture))];

    public JsonSchema ResponseSchema(string path, string method, int status) =>
        Compile(
            Operation(path, method)["responses"]![status.ToString(CultureInfo.InvariantCulture)]!["content"]!["application/json"]!["schema"]!);

    public JsonSchema ProblemSchema => Compile(Component("ProblemDetails"));

    public static bool Matches(JsonSchema schema, JsonNode body) =>
        schema.Evaluate(JsonSerializer.SerializeToElement(body), new EvaluationOptions { RequireFormatValidation = true }).IsValid;

    public JsonSchema RequestSchema(string path, string method) =>
        Compile(Operation(path, method)["requestBody"]!["content"]!["application/json"]!["schema"]!);

    // Имя схемы тела запроса операции (для выбора примера из контракта).
    public string RequestSchemaName(string path, string method)
    {
        var schema = Operation(path, method)["requestBody"]!["content"]!["application/json"]!["schema"]!;
        return schema["$ref"]!.GetValue<string>().Split('/').Last();
    }

    // Пример тела из компонента контракта (example схемы).
    public JsonNode RequestExample(string schemaName) => Component(schemaName)["example"]!.DeepClone();

    private JsonObject Operations => (JsonObject)_document["paths"]!;

    private JsonObject Components => (JsonObject)_document["components"]!["schemas"]!;

    private JsonNode Component(string name) => Components[name]!;

    private JsonNode Operation(string path, string method) => _document["paths"]![path]![method]!;

    private JsonNode Property(string componentName, string propertyName) =>
        Components[componentName]!["properties"]![propertyName]!;

    private static Dictionary<string, IReadOnlyList<string>> ReadPathMethods(JsonNode document)
    {
        var result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach (var pair in document["paths"]!.AsObject())
        {
            result[pair.Key] = [.. pair.Value!.AsObject().Select(method => method.Key)];
        }

        return result;
    }

    private static OpenApiContract Load()
    {
        var stream = new YamlStream();
        using var reader = new StringReader(File.ReadAllText(ContractPath(), Encoding.UTF8));
        stream.Load(reader);
        return new OpenApiContract(ToJsonNode(stream.Documents[0].RootNode));
    }

    private static string ContractPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "contract", "openapi", "openapi.yaml");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException(
            "contract/openapi/openapi.yaml не найден выше каталога " + AppContext.BaseDirectory);
    }

    private JsonSchema Compile(JsonNode openApiSchema)
    {
        var jsonSchema = ConvertSchema(openApiSchema);
        jsonSchema["$schema"] = JsonValue.Create(JsonSchemaVersion);
        return JsonSchema.FromText(jsonSchema.ToJsonString());
    }

    // OpenAPI 3.0 — не JSON Schema: раскрываем $ref и убираем nullable.
    // Прочие ключи (type, required, enum, pattern, format) переносятся как есть.
    private JsonObject ConvertSchema(JsonNode schema)
    {
        var result = new JsonObject();
        foreach (var pair in schema.AsObject())
        {
            switch (pair.Key)
            {
                case "$ref":
                    var target = ResolveReference(pair.Value!.GetValue<string>());
                    foreach (var converted in ConvertSchema(target).AsObject())
                    {
                        result[converted.Key] = converted.Value?.DeepClone();
                    }

                    break;
                case "nullable":
                    break;
                // TypeSpec оборачивает ссылку на вложенную модель в allOf, чтобы
                // добавить описание свойства; раскрываем и сливаем подсхемы.
                case "allOf":
                    foreach (var item in pair.Value!.AsArray())
                    {
                        Merge(result, ConvertSchema(item!));
                    }

                    break;
                case "items" or "additionalProperties" when pair.Value is JsonObject:
                    result[pair.Key] = ConvertSchema(pair.Value);
                    break;
                case "anyOf" or "oneOf":
                    var alternatives = new JsonArray();
                    foreach (var item in pair.Value!.AsArray())
                    {
                        alternatives.Add(ConvertSchema(item!));
                    }

                    result[pair.Key] = alternatives;
                    break;
                case "properties":
                    var properties = new JsonObject();
                    foreach (var property in pair.Value!.AsObject())
                    {
                        properties[property.Key] = ConvertSchema(property.Value!);
                    }

                    result[pair.Key] = properties;
                    break;
                default:
                    result[pair.Key] = pair.Value?.DeepClone();
                    break;
            }
        }

        if (schema["nullable"]?.GetValue<bool>() is true && result["type"] is not null)
        {
            result["type"] = new JsonArray(result["type"]!.DeepClone(), JsonValue.Create("null"));
        }

        return result;
    }

    private static void Merge(JsonObject target, JsonObject source)
    {
        foreach (var pair in source)
        {
            if (pair.Key == "properties"
                && pair.Value is JsonObject properties
                && target["properties"] is JsonObject existingProperties)
            {
                foreach (var property in properties)
                {
                    existingProperties[property.Key] = property.Value?.DeepClone();
                }

                continue;
            }

            if (pair.Key == "required"
                && pair.Value is JsonArray required
                && target["required"] is JsonArray existingRequired)
            {
                foreach (var value in required)
                {
                    existingRequired.Add(value?.DeepClone());
                }

                continue;
            }

            target[pair.Key] = pair.Value?.DeepClone();
        }
    }

    // Ссылки вида "#/components/schemas/Name" раскрываются рекурсией; циклов модели не содержат.
    private JsonNode ResolveReference(string reference)
    {
        const string prefix = "#/";
        if (!reference.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new NotSupportedException($"Неподдерживаемая ссылка контракта: {reference}");
        }

        JsonNode node = _document;
        foreach (var segment in reference[prefix.Length..].Split('/'))
        {
            node = node[segment]!;
        }

        return node;
    }

    private static JsonNode ToJsonNode(YamlNode node) =>
        node switch
        {
            YamlMappingNode mapping => ToJsonObject(mapping),
            YamlSequenceNode sequence => ToJsonArray(sequence),
            YamlScalarNode scalar => ToJsonValue(scalar),
            _ => throw new NotSupportedException($"Неподдерживаемый узел YAML: {node.NodeType}"),
        };

    private static JsonObject ToJsonObject(YamlMappingNode mapping)
    {
        var result = new JsonObject();
        foreach (var pair in mapping.Children)
        {
            var key = ((YamlScalarNode)pair.Key).Value
                ?? throw new NotSupportedException("Пустой ключ в контракте.");
            result[key] = ToJsonNode(pair.Value);
        }

        return result;
    }

    private static JsonArray ToJsonArray(YamlSequenceNode sequence)
    {
        var result = new JsonArray();
        foreach (var item in sequence.Children)
        {
            result.Add(ToJsonNode(item));
        }

        return result;
    }

    private static JsonNode ToJsonValue(YamlScalarNode scalar)
    {
        var value = scalar.Value;
        if (string.IsNullOrEmpty(value))
        {
            return JsonNode.Parse("null")!;
        }

        if (long.TryParse(value, CultureInfo.InvariantCulture, out var number))
        {
            return JsonValue.Create(number);
        }

        if (value is "true" or "false")
        {
            return JsonValue.Create(bool.Parse(value));
        }

        return JsonValue.Create(value);
    }
}
