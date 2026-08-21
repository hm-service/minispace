FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY MiniSpace.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .
ENV DATA_DIR=/data
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["dotnet", "MiniSpace.dll"]
