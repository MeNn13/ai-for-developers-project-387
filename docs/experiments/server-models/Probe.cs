using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using BookingCalendar;
using BookingCalendar.Api.Tests;
using Json.Schema;

var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
// Same null handling as production Http/Problems.cs.
var problemOptions = new JsonSerializerOptions(options) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
var start = DateTimeOffset.Parse("2026-11-09T10:00:00+03:00", System.Globalization.CultureInfo.InvariantCulture);
var meetingType = new MeetingType { Id = "intro", Title = "Intro", Description = "", DurationMinutes = 30 };
var meeting = new Meeting { Id = "14888a80-4f05-4218-97f4-88f08aee86df", MeetingTypeId = "intro", MeetingTypeTitle = "Intro", DurationMinutes = 30, Start = start, End = start.AddMinutes(30), GuestName = "Guest" };
var samples = new Dictionary<string, object>
{
    ["HealthResponse"] = new HealthResponse(),
    ["MeetingType"] = meetingType,
    ["MeetingTypes"] = new[] { meetingType },
    ["Meeting"] = meeting,
    ["Meetings"] = new[] { meeting },
    ["MeetingCreateRequest"] = new MeetingCreateRequest { MeetingTypeId = "intro", Start = start, GuestName = "Guest" },
    ["MeetingCreatedResponse"] = new MeetingCreatedResponse { Body = meeting },
    ["MeetingTypeCreatedResponse"] = new MeetingTypeCreatedResponse { Body = meetingType },
    ["SlotsResponse"] = new SlotsResponse { Timezone = "Europe/Moscow", Window = new SlotWindow { From = DateOnly.FromDateTime(start.Date), To = DateOnly.FromDateTime(start.Date.AddDays(13)) }, Days = Enumerable.Range(0, 14).Select(i => new SlotDay { Date = DateOnly.FromDateTime(start.Date.AddDays(i)), Slots = i == 0 ? [new Slot { Start = start, End = start.AddMinutes(30), Available = true }] : [] }).ToArray() },
};
foreach (var (slug, status) in new[] { ("validation-failed", 400), ("meeting-type-not-found", 404), ("slot-taken", 409), ("slot-not-bookable", 400), ("meeting-type-exists", 409) })
{
    var problem = new ProblemDetails { Type = slug, Title = "Error", Status = status, Detail = "Details", Instance = "/api/meetings" };
    if (slug == "validation-failed") problem.Errors = new Dictionary<string, string[]> { ["start"] = ["Invalid"] };
    samples[slug] = problem;
}
Directory.CreateDirectory("docs/experiments/server-models/artifacts");
File.WriteAllText("docs/experiments/server-models/artifacts/wire.json", JsonSerializer.Serialize(samples.ToDictionary(pair => pair.Key, pair => JsonSerializer.SerializeToNode(pair.Value, pair.Value is ProblemDetails ? problemOptions : options)), options));
Console.WriteLine("Serialized " + samples.Count + " samples to artifacts/wire.json");

var contract = OpenApiContract.Instance;
var failures = 0;
foreach (var (name, path, method, status) in new[]
{
    ("HealthResponse", "/api/health", "get", 200),
    ("MeetingTypes", "/api/meeting-types", "get", 200),
    ("MeetingType", "/api/meeting-types", "post", 201),
    ("Meetings", "/api/meetings", "get", 200),
    ("Meeting", "/api/meetings", "post", 201),
    ("SlotsResponse", "/api/slots", "get", 200),
    ("validation-failed", "/api/meetings", "post", 400),
    ("meeting-type-not-found", "/api/meetings", "post", 404),
    ("slot-taken", "/api/meetings", "post", 409),
    ("slot-not-bookable", "/api/meetings", "post", 400),
    ("meeting-type-exists", "/api/meeting-types", "post", 409),
})
{
    var json = JsonSerializer.SerializeToNode(samples[name], status >= 400 ? problemOptions : options)!;
    var schema = status >= 400 ? contract.ProblemSchema : contract.ResponseSchema(path, method, status);
    Check(name + " status declared", contract.ResponseStatusCodes(path, method).Contains(status));
    var result = schema.Evaluate(JsonSerializer.SerializeToElement(json),
        new EvaluationOptions { RequireFormatValidation = true, OutputFormat = OutputFormat.List });
    Console.WriteLine($"{name}: schema {(result.IsValid ? "PASS" : "FAIL")}");
    if (!result.IsValid) failures++;
}

var meetingJson = JsonSerializer.SerializeToNode(meeting, options)!;
Check("UUID", Guid.TryParse(meetingJson["id"]!.GetValue<string>(), out _));
Check("offset", meetingJson["start"]!.GetValue<string>().EndsWith("+03:00", StringComparison.Ordinal));
var requestJson = JsonSerializer.SerializeToNode(samples["MeetingCreateRequest"], options)!;
Check("request fields", requestJson.AsObject().Count == 3 && requestJson["guestName"]!.GetValue<string>() == "Guest" && requestJson["meetingTypeId"]!.GetValue<string>() == "intro");
Check("request offset", requestJson["start"]!.GetValue<string>() == "2026-11-09T10:00:00+03:00");
var slotsJson = JsonSerializer.SerializeToNode(samples["SlotsResponse"], options)!;
Check("date-only", slotsJson["window"]!["from"]!.GetValue<string>() == "2026-11-09");
foreach (var slug in contract.ProblemTypeSlugs.Where(slug => slug != "validation-failed"))
{
    if (samples.TryGetValue(slug, out var problem))
        Check(slug + " omits errors", !JsonSerializer.SerializeToNode(problem, problemOptions)!.AsObject().ContainsKey("errors"));
}
var invalidEnum = JsonSerializer.SerializeToNode(samples["slot-taken"], problemOptions)!;
invalidEnum["type"] = "not-a-contract-slug";
Check("schema rejects invalid enum", !contract.ProblemSchema.Evaluate(JsonSerializer.SerializeToElement(invalidEnum)).IsValid);
foreach (var (name, path) in new[] { ("MeetingCreatedResponse", "/api/meetings"), ("MeetingTypeCreatedResponse", "/api/meeting-types") })
{
    var envelope = JsonSerializer.SerializeToNode(samples[name], options)!;
    var schema = contract.ResponseSchema(path, "post", 201);
    Check(name + " envelope rejected", !schema.Evaluate(JsonSerializer.SerializeToElement(envelope)).IsValid);
    Check(name + " body accepted", schema.Evaluate(JsonSerializer.SerializeToElement(envelope["body"])).IsValid);
}
Console.WriteLine($"Wire incompatibilities: {failures}");
return failures == 0 ? 0 : 1;

void Check(string name, bool passed)
{
    Console.WriteLine($"{name}: {(passed ? "PASS" : "FAIL")}");
    if (!passed) failures++;
}
