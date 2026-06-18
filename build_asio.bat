@echo off
REM ============================================================
REM  Opencast — ASIO Build Script
REM  Requires: MSYS2/MinGW64  (gcc + pkg-config from mingw-w64)
REM  No ASIO SDK or PortAudio needed — ASIO is implemented natively.
REM ============================================================

echo.
echo  Opencast ASIO Build
echo  ==========================================
echo.

REM --- Add MSYS2 MinGW64 to PATH if gcc not already visible ---
where gcc >nul 2>&1
if errorlevel 1 (
    if exist "C:\msys64\mingw64\bin\gcc.exe" (
        echo [INFO] GCC nicht im PATH gefunden, fuege C:\msys64\mingw64\bin hinzu
        set "PATH=C:\msys64\mingw64\bin;%PATH%"
    ) else (
        echo [ERROR] gcc nicht gefunden. MSYS2 installieren und ausfuehren:
        echo         pacman -S mingw-w64-x86_64-gcc
        exit /b 1
    )
)
echo [OK] gcc found
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
if errorlevel 1 ( echo [ERROR] Frontend build failed & exit /b 1 )
cd ..
echo [OK] Frontend built

REM --- Build Go backend with ASIO ---
echo.
echo Building Go backend with native ASIO support...
cd backend
set CGO_ENABLED=1
go mod tidy
go build -tags asio -o opencast-asio.exe .
if errorlevel 1 ( echo [ERROR] Go ASIO build failed & exit /b 1 )
cd ..

echo.
echo  ==========================================
echo  [OK] opencast-asio.exe ready
echo.
echo       Supported audio interfaces:
echo         WASAPI  — built-in, always available
echo         ASIO    — reads HKLM\SOFTWARE\ASIO registry;
echo                   install the Steinberg/Yamaha USB ASIO
echo                   driver for your UR22mkII first.
echo.
echo       Run:  backend\opencast-asio.exe
echo       Open: http://localhost:8765
echo  ==========================================
echo.
