@echo off
REM ============================================================
REM  Opencast — ASIO Build Script
REM  Baut: server/opencast-server.exe + client/opencast-client-asio.exe
REM  Erfordert: WinLibs/MinGW64 gcc fuer CGo (ASIO-Client)
REM ============================================================

echo.
echo  Opencast ASIO Build
echo  ==========================================
echo.

REM --- GCC-Pfad (WinLibs via WinGet) ---
set "GCC_PATH=C:\Users\waldemar.toews\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"

where gcc >nul 2>&1
if errorlevel 1 (
    if exist "%GCC_PATH%\gcc.exe" (
        echo [INFO] GCC nicht im PATH, fuege WinLibs hinzu
        set "PATH=%GCC_PATH%;%PATH%"
    ) else (
        echo [ERROR] gcc nicht gefunden. WinLibs installieren:
        echo         winget install BrechtSanders.WinLibs.POSIX.MSVCRT
        exit /b 1
    )
)
echo [OK] gcc gefunden:
for /f "tokens=*" %%i in ('gcc --version 2^>^&1') do (
    echo      %%i
    goto :gcc_done
)
:gcc_done

REM --- Build frontend ---
echo.
echo Building frontend...
cd frontend
call npm run build
if errorlevel 1 ( echo [ERROR] Frontend build failed & cd .. & exit /b 1 )
cd ..
echo [OK] Frontend gebaut (server/dist/)

REM --- Build Server (reines Go, kein CGo) ---
echo.
echo Building Server (server/)...
cd server
go build -o opencast-server.exe .
if errorlevel 1 ( echo [ERROR] Server build failed & cd .. & exit /b 1 )
cd ..
echo [OK] server\opencast-server.exe

REM --- Build Client mit ASIO (CGo + Windows-Tags) ---
echo.
echo Building Client mit ASIO (client/)...
cd client
set CGO_ENABLED=1
go build -tags "windows asio" -o opencast-client-asio.exe .
if errorlevel 1 ( echo [ERROR] Client ASIO build failed & cd .. & exit /b 1 )
cd ..
echo [OK] client\opencast-client-asio.exe

echo.
echo  ==========================================
echo  Build erfolgreich:
echo    server\opencast-server.exe   -- REST API + Frontend (Port 8765)
echo    client\opencast-client-asio.exe -- Tray-Client, WASAPI + ASIO
echo.
echo  Starten:
echo    1. server\opencast-server.exe
echo    2. client\opencast-client-asio.exe
echo    3. http://localhost:8765
echo  ==========================================
echo.
