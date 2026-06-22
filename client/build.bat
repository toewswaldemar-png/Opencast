@echo off
echo Baue opencast-client.exe (WASAPI, ohne ASIO)...
go build -ldflags="-H windowsgui" -o opencast-client.exe .
if errorlevel 1 (
    echo Build fehlgeschlagen!
    exit /b 1
)
echo OK: opencast-client.exe
