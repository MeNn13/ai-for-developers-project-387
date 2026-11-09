# syntax=docker/dockerfile:1

# One image serves both the API and the built frontend: Hexlet runs the project
# as a container, and a single process and a single port make that check simple.

FROM node:24-bookworm-slim AS web

WORKDIR /src

# The workspace manifests first, so a source change does not reinstall the
# dependency tree.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY contract/package.json contract/
RUN npm ci

COPY frontend/ frontend/
RUN npm run build --workspace frontend


FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api

WORKDIR /src

COPY Directory.Build.props ./
COPY backend/ backend/

# The lock files are committed, so a restore that had to pick new versions
# would fail here rather than produce a different build than CI.
RUN dotnet restore backend/BookingCalendar.sln --locked-mode \
    && dotnet publish backend/BookingCalendar.Api/BookingCalendar.Api.csproj \
       --configuration Release --output /out --no-restore


FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final

WORKDIR /app

ENV PORT=8080
EXPOSE 8080

COPY --from=api /out ./
COPY --from=web /src/frontend/dist ./wwwroot

# The image ships an unprivileged user; nothing here needs root. The id comes
# from the base image (APP_UID), so hadolint cannot see a number: pinning 1654
# here would silently break if the base image ever changes it.
# hadolint ignore=DL3066
USER $APP_UID

# Expand the hosting platform's PORT at startup and forward signals to dotnet.
ENTRYPOINT ["sh", "-c", "exec dotnet BookingCalendar.Api.dll --urls \"http://0.0.0.0:${PORT}\""]
