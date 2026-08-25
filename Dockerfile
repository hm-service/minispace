# ==========
# Build
# ==========
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY MiniSpace.csproj .

RUN dotnet restore

COPY . .

RUN dotnet publish -c Release -o /out

# ==========
# Run
# ==========
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

ENV DATA_DIR=/data
ENV ASPNETCORE_HTTP_PORTS=8080
ENV TZ=Asia/Shanghai

COPY --from=build /out /app

EXPOSE 8080

VOLUME ["/data"]

WORKDIR /app
USER 1000:1000
ENTRYPOINT ["dotnet", "MiniSpace.dll"]
