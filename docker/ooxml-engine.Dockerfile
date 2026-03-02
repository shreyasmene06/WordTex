FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder
WORKDIR /src
COPY proto ./proto
COPY services/ooxml-engine/ ./services/ooxml-engine/
WORKDIR /src/services/ooxml-engine
RUN dotnet restore
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
WORKDIR /app
COPY --from=builder /out .
EXPOSE 8080 50054
USER 1000:1000
ENTRYPOINT ["dotnet", "OoxmlEngine.dll"]
