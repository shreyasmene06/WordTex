using Serilog;
using WordTex.OoxmlEngine.Services;

var builder = WebApplication.CreateBuilder(args);

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .MinimumLevel.Information()
    .Enrich.FromLogContext()
    .CreateLogger();

builder.Host.UseSerilog();

builder.Services.AddGrpc();
builder.Services.AddSingleton<DocumentService>();
builder.Services.AddSingleton<StyleService>();
builder.Services.AddSingleton<MathService>();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapGrpcService<OoxmlGrpcService>();
app.MapHealthChecks("/health");
app.MapGet("/ready", () => Results.Ok(new { status = "ready" }));

Log.Information("OOXML Engine starting on {Port}", app.Urls);
app.Run();
