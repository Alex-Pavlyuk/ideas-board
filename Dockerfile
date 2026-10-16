# syntax=docker/dockerfile:1
# ---- build stage: full SDK, restore + publish ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app --no-restore

# ---- runtime stage: ASP.NET runtime only, non-root ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true
COPY --from=build /app ./

# No volume and no data directory: the container is stateless on purpose. It
# used to hold the whole board in a SQLite file here, and that file did not
# survive a release — a deployment that starts every release as a NEW container
# gives a VOLUME path a fresh anonymous volume each time, so the board silently
# reset. State belongs in Postgres, reached through
# DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.

EXPOSE 8080
# The .NET 10 base image ships a non-root user exposed as $APP_UID.
USER $APP_UID
# AssemblyName is fixed to "app" in IdeasBoard.csproj -> app.dll.
ENTRYPOINT ["dotnet", "app.dll"]
