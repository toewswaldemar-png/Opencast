@echo off
echo Baue opencast-client-asio.exe (WASAPI + ASIO)...
go build -tags asio -ldflags="-H windowsgui" -o opencast-client-asio.exe .
if errorlevel 1 (
    echo Build fehlgeschlagen!
    exit /b 1
)
echo OK: opencast-client-asio.exe
