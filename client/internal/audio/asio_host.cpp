//go:build windows && asio

#include <windows.h>
#include "iasiodrv.h"

extern "C" {
#include "asio_host.h"
}

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static const IID IID_IASIO = {
    0x8F97B4C1, 0x33A2, 0x11d3,
    {0x8C, 0xD0, 0x00, 0xA0, 0xC9, 0x8A, 0x67, 0xAD}
};

#define MAX_ASIO_CHANNELS 64  // doubled: up to 32 in + 32 out for duplex

static IASIO         *g_asio          = nullptr;
static ASIOBufferInfo g_bufInfos[MAX_ASIO_CHANNELS];
static long           g_bufferSize    = 0;
static long           g_sampleType    = ASIOSTInt32LSB;
static int            g_numChannels   = 0;
static int            g_numOutCh      = 0;
static int16_t       *g_pcmBuf        = nullptr;
static HANDLE         g_stopEvent     = nullptr;

extern "C" void goAsioBufferCallback(void *data, int numFrames, int sampleType, int numChannels);

static int16_t asio_sample_to_i16(long sampleType, const void *buf, long frame) {
    switch (sampleType) {
    case ASIOSTInt32LSB: {
        int32_t v = ((const int32_t *)buf)[frame];
        return (int16_t)(v >> 16);
    }
    case ASIOSTInt16LSB:
        return ((const int16_t *)buf)[frame];
    case ASIOSTFloat32LSB: {
        float v = ((const float *)buf)[frame];
        if (v >  1.0f) v =  1.0f;
        if (v < -1.0f) v = -1.0f;
        return (int16_t)(v * 32767.0f);
    }
    case ASIOSTFloat64LSB: {
        double v = ((const double *)buf)[frame];
        if (v >  1.0) v =  1.0;
        if (v < -1.0) v = -1.0;
        return (int16_t)(v * 32767.0);
    }
    case ASIOSTInt24LSB: {
        const uint8_t *b = (const uint8_t *)buf + frame * 3;
        // Build via uint32_t to avoid signed-overflow UB, then reinterpret as signed.
        int32_t v = (int32_t)(((uint32_t)b[2] << 24) | ((uint32_t)b[1] << 16) | ((uint32_t)b[0] << 8));
        return (int16_t)(v >> 16);
    }
    case ASIOSTInt32MSB: {
        int32_t raw = ((const int32_t *)buf)[frame];
        int32_t v = (int32_t)(
            ((raw & 0x000000FF) << 24) |
            ((raw & 0x0000FF00) <<  8) |
            ((raw & 0x00FF0000) >>  8) |
            ((raw & 0xFF000000) >> 24));
        return (int16_t)(v >> 16);
    }
    case ASIOSTInt16MSB: {
        int16_t raw = ((const int16_t *)buf)[frame];
        return (int16_t)(((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF));
    }
    default: {
        int32_t v = ((const int32_t *)buf)[frame];
        return (int16_t)(v >> 16);
    }
    }
}

static void asio_buffer_switch(long idx, ASIOBool directProcess);
static void asio_sample_rate_changed(ASIOSampleRate sRate);
static long asio_message(long selector, long value, void *message, double *opt);
static ASIOTime *asio_buffer_switch_time_info(ASIOTime *params, long idx, ASIOBool directProcess);

static ASIOCallbacks g_callbacks = {
    asio_buffer_switch,
    asio_sample_rate_changed,
    asio_message,
    asio_buffer_switch_time_info,
};

static void asio_buffer_switch(long idx, ASIOBool directProcess) {
    (void)directProcess;
    if (!g_asio || g_numChannels == 0 || g_bufferSize == 0 || !g_pcmBuf) return;

    // Read input channels → PCM buffer
    for (long frame = 0; frame < g_bufferSize; frame++) {
        for (int ch = 0; ch < g_numChannels; ch++) {
            void *buf = g_bufInfos[ch].buffers[idx];
            g_pcmBuf[frame * g_numChannels + ch] = buf ? asio_sample_to_i16(g_sampleType, buf, frame) : 0;
        }
    }

    // Zero output channels so the driver receives silence (duplex mode)
    for (int i = 0; i < g_numOutCh; i++) {
        void *outBuf = g_bufInfos[g_numChannels + i].buffers[idx];
        if (outBuf) memset(outBuf, 0, (size_t)g_bufferSize * 4);  // 4 bytes covers int32/float32
    }

    // Signal output-ready — some drivers (e.g. ReaRoute) gate callbacks until this is called
    if (g_numOutCh > 0) g_asio->outputReady();

    goAsioBufferCallback(g_pcmBuf, (int)g_bufferSize, (int)g_sampleType, g_numChannels);
}

static void asio_sample_rate_changed(ASIOSampleRate sRate) { (void)sRate; }

static long asio_message(long selector, long value, void *message, double *opt) {
    (void)message; (void)opt; (void)value;
    switch (selector) {
    case kAsioSelectorSupported:
        return (value == kAsioEngineVersion || value == kAsioResetRequest ||
                value == kAsioSupportsTimeInfo || value == kAsioLatenciesChanged) ? 1L : 0L;
    case kAsioEngineVersion:     return 2L;
    case kAsioResetRequest:      return 1L;
    case kAsioSupportsTimeInfo:  return 1L;  // ReaRoute requires bufferSwitchTimeInfo
    case kAsioSupportsTimeCode:  return 0L;
    default:                     return 0L;
    }
}

static ASIOTime *asio_buffer_switch_time_info(ASIOTime *params, long idx, ASIOBool directProcess) {
    asio_buffer_switch(idx, directProcess);
    return params;
}

int asio_enumerate_drivers(ASIORegEntry *drivers, int maxDrivers) {
    HKEY hRoot;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\ASIO", 0, KEY_READ, &hRoot) != ERROR_SUCCESS)
        return 0;

    int count = 0; DWORD idx = 0;
    char subKey[256]; DWORD subKeyLen;

    while (count < maxDrivers) {
        subKeyLen = sizeof(subKey);
        LONG ret = RegEnumKeyExA(hRoot, idx++, subKey, &subKeyLen, nullptr, nullptr, nullptr, nullptr);
        if (ret == ERROR_NO_MORE_ITEMS) break;
        if (ret != ERROR_SUCCESS) continue;

        HKEY hDrv;
        if (RegOpenKeyExA(hRoot, subKey, 0, KEY_READ, &hDrv) != ERROR_SUCCESS) continue;

        char clsidStr[64] = {0}; DWORD clsidLen = sizeof(clsidStr); DWORD type;
        LONG qr = RegQueryValueExA(hDrv, "CLSID", nullptr, &type, (LPBYTE)clsidStr, &clsidLen);
        RegCloseKey(hDrv);

        if (qr == ERROR_SUCCESS && type == REG_SZ && clsidStr[0] != '\0') {
            strncpy(drivers[count].name,  subKey,   sizeof(drivers[count].name)  - 1);
            strncpy(drivers[count].clsid, clsidStr, sizeof(drivers[count].clsid) - 1);
            drivers[count].name [sizeof(drivers[count].name)  - 1] = '\0';
            drivers[count].clsid[sizeof(drivers[count].clsid) - 1] = '\0';
            count++;
        }
    }
    RegCloseKey(hRoot);
    return count;
}

int asio_open_driver(const char *clsidStr, char *errBuf, int errLen) {
    if (g_asio) asio_release_driver();

    CLSID clsid; wchar_t wclsid[64];
    if (MultiByteToWideChar(CP_ACP, 0, clsidStr, -1, wclsid, 64) == 0) {
        snprintf(errBuf, errLen, "MultiByteToWideChar failed"); return -1;
    }
    if (CLSIDFromString(wclsid, &clsid) != S_OK) {
        snprintf(errBuf, errLen, "ungueltige CLSID: %s", clsidStr); return -1;
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE && hr != (HRESULT)S_FALSE) {
        snprintf(errBuf, errLen, "CoInitializeEx: 0x%08X", (unsigned)hr); return -1;
    }

    hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER,
                          clsid, reinterpret_cast<void **>(&g_asio));
    if (FAILED(hr)) {
        snprintf(errBuf, errLen, "CoCreateInstance: 0x%08X", (unsigned)hr);
        CoUninitialize(); return -1;
    }

    if (!g_asio->init((void *)GetDesktopWindow())) {
        char drvErr[256] = {0};
        g_asio->getErrorMessage(drvErr);
        snprintf(errBuf, errLen, "ASIO init() fehlgeschlagen: %s", drvErr);
        g_asio->Release(); g_asio = nullptr; CoUninitialize(); return -1;
    }
    return 0;
}

int asio_get_driver_info(long *numInputCh, double *defSampleRate, char *errBuf, int errLen) {
    if (!g_asio) { snprintf(errBuf, errLen, "kein Treiber geoeffnet"); return -1; }
    long numOut = 0;
    ASIOError err = g_asio->getChannels(numInputCh, &numOut);
    if (err != ASE_OK) { snprintf(errBuf, errLen, "getChannels Fehler: %ld", err); return -1; }
    ASIOSampleRate sr = 48000.0;
    g_asio->getSampleRate(&sr);
    *defSampleRate = sr;
    return 0;
}

long asio_get_preferred_buffer_size(void) {
    if (!g_asio) return 512;
    long minSz, maxSz, prefSz, gran;
    ASIOError err = g_asio->getBufferSize(&minSz, &maxSz, &prefSz, &gran);
    return (err == ASE_OK) ? prefSz : 512;
}

int asio_start_capture(int *channels, int numChannels, long bufferSize,
                       double sampleRate, char *errBuf, int errLen) {
    if (!g_asio) { snprintf(errBuf, errLen, "kein Treiber geoeffnet"); return -1; }
    if (numChannels > MAX_ASIO_CHANNELS / 2) numChannels = MAX_ASIO_CHANNELS / 2;

    // Handle sample rate: only call setSampleRate when the rate actually needs
    // to change.  Calling it with the current rate (even the same value) on USB
    // hardware interfaces (e.g. UR22mkII) triggers a full clock re-sync over USB
    // which takes 10-20 s.  For virtual drivers that require the call to unblock
    // callbacks (e.g. ReaRoute, canSampleRate != ASE_OK path), we still call it.
    ASIOSampleRate actualSR = 48000.0;
    g_asio->getSampleRate(&actualSR);
    {
        ASIOError canErr = g_asio->canSampleRate((ASIOSampleRate)sampleRate);
        if (canErr == ASE_OK) {
            // Only switch if the requested rate genuinely differs.
            if (actualSR < sampleRate - 1.0 || actualSR > sampleRate + 1.0) {
                g_asio->setSampleRate((ASIOSampleRate)sampleRate);
                g_asio->getSampleRate(&actualSR);
            }
        } else {
            // Driver cannot do the requested rate.  Confirm the current rate so
            // virtual drivers (ReaRoute) are unblocked before createBuffers.
            g_asio->setSampleRate(actualSR);
        }
    }

    // Input channels
    memset(g_bufInfos, 0, sizeof(g_bufInfos));
    for (int i = 0; i < numChannels; i++) {
        g_bufInfos[i].isInput    = ASIOTrue;
        g_bufInfos[i].channelNum = (long)channels[i];
    }

    // Output channels (duplex): some drivers (including ReaRoute) only activate
    // input callbacks when the client also registers output channels. We zero
    // the output buffers in every callback so they produce silence in REAPER.
    long numInDrv = 0, numOutDrv = 0;
    g_asio->getChannels(&numInDrv, &numOutDrv);
    int numOut = (numOutDrv >= 2) ? 2 : (int)numOutDrv;
    for (int i = 0; i < numOut; i++) {
        g_bufInfos[numChannels + i].isInput    = ASIOFalse;
        g_bufInfos[numChannels + i].channelNum = (long)i;
    }
    g_numOutCh = numOut;

    long totalCh = (long)(numChannels + numOut);
    ASIOError err = g_asio->createBuffers(g_bufInfos, totalCh, bufferSize, &g_callbacks);
    if (err != ASE_OK) { snprintf(errBuf, errLen, "createBuffers Fehler: %ld", err); return -1; }

    // Detect input sample type
    ASIOChannelInfo chInfo; memset(&chInfo, 0, sizeof(chInfo));
    chInfo.channel = (long)channels[0]; chInfo.isInput = ASIOTrue;
    err = g_asio->getChannelInfo(&chInfo);
    g_sampleType = (err == ASE_OK) ? (long)chInfo.type : (long)ASIOSTInt32LSB;

    g_bufferSize  = bufferSize;
    g_numChannels = numChannels;

    free(g_pcmBuf);
    g_pcmBuf = (int16_t *)malloc((size_t)numChannels * (size_t)bufferSize * sizeof(int16_t));
    if (!g_pcmBuf) {
        g_asio->disposeBuffers();
        g_numChannels = 0; g_bufferSize = 0; g_numOutCh = 0;
        snprintf(errBuf, errLen, "malloc PCM-Puffer fehlgeschlagen"); return -1;
    }

    err = g_asio->start();
    if (err != ASE_OK) {
        free(g_pcmBuf); g_pcmBuf = nullptr;
        g_numChannels = 0; g_bufferSize = 0; g_numOutCh = 0;
        g_asio->disposeBuffers();
        snprintf(errBuf, errLen, "ASIO start() Fehler: %ld", err); return -1;
    }

    g_stopEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);
    if (!g_stopEvent) {
        g_asio->stop();
        free(g_pcmBuf); g_pcmBuf = nullptr;
        g_numChannels = 0; g_bufferSize = 0; g_numOutCh = 0;
        g_asio->disposeBuffers();
        snprintf(errBuf, errLen, "CreateEvent fehlgeschlagen"); return -1;
    }
    return 0;
}

void asio_stop(void) {
    if (g_stopEvent) SetEvent(g_stopEvent);
}

void asio_run_message_pump(void) {
    if (!g_stopEvent) return;
    MSG msg;
    while (1) {
        DWORD r = MsgWaitForMultipleObjects(1, &g_stopEvent, FALSE, INFINITE, QS_ALLINPUT);
        if (r == WAIT_OBJECT_0) break;
        if (r == WAIT_OBJECT_0 + 1) {
            while (PeekMessageA(&msg, nullptr, 0, 0, PM_REMOVE)) {
                if (msg.message == WM_QUIT) goto cleanup;
                TranslateMessage(&msg);
                DispatchMessage(&msg);
            }
        }
    }
cleanup:
    if (g_asio) { g_asio->stop(); g_asio->disposeBuffers(); }
    g_numChannels = 0; g_bufferSize = 0;
    free(g_pcmBuf); g_pcmBuf = nullptr;
    CloseHandle(g_stopEvent); g_stopEvent = nullptr;
}

int asio_probe_driver(const char *clsidStr, long *numInputCh, double *sampleRate) {
    if (g_asio) { *numInputCh = 0; *sampleRate = 0; return -1; }
    char errBuf[256];
    if (asio_open_driver(clsidStr, errBuf, sizeof(errBuf)) != 0) return -1;
    int ret = asio_get_driver_info(numInputCh, sampleRate, errBuf, sizeof(errBuf));
    asio_release_driver();
    return ret;
}

void asio_release_driver(void) {
    if (!g_asio) return;
    g_asio->Release(); g_asio = nullptr;
    if (g_stopEvent) { CloseHandle(g_stopEvent); g_stopEvent = nullptr; }
    free(g_pcmBuf); g_pcmBuf = nullptr;
    g_numChannels = 0; g_bufferSize = 0; g_numOutCh = 0;
    CoUninitialize();
}

/* ── Control panel ─────────────────────────────────────────────────── */

typedef struct { char clsid[64]; } PanelArg;

#define MAX_SNAP 256
static DWORD g_monPid;
static HWND  g_monSnap[MAX_SNAP];
static int   g_monSnapN;

static BOOL CALLBACK mon_snap_cb(HWND hwnd, LPARAM) {
    if (g_monSnapN < MAX_SNAP) g_monSnap[g_monSnapN++] = hwnd;
    return TRUE;
}

static void CALLBACK mon_event_cb(
        HWINEVENTHOOK, DWORD, HWND hwnd,
        LONG idObject, LONG, DWORD, DWORD) {
    if (idObject != OBJID_WINDOW || !hwnd) return;
    if (!IsWindowVisible(hwnd)) return;
    RECT rc = {};
    GetWindowRect(hwnd, &rc);
    if ((rc.right - rc.left) < 40 || (rc.bottom - rc.top) < 20) return;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid != g_monPid) return;
    for (int i = 0; i < g_monSnapN; ++i)
        if (g_monSnap[i] == hwnd) return;

    /* Always-on-top (no foreground permission needed) */
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

    /* Try to activate (succeeds when we're the foreground process — which
     * we are as a tray app right after a user click) */
    HWND  fgWnd = GetForegroundWindow();
    DWORD fgTid = fgWnd ? GetWindowThreadProcessId(fgWnd, nullptr) : 0;
    DWORD myTid = GetCurrentThreadId();
    if (fgTid && fgTid != myTid) AttachThreadInput(fgTid, myTid, TRUE);
    SetForegroundWindow(hwnd);
    if (fgTid && fgTid != myTid) AttachThreadInput(fgTid, myTid, FALSE);

    PostQuitMessage(0);
}

static DWORD WINAPI mon_thread_func(void *) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    HWINEVENTHOOK hk = SetWinEventHook(
        EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW,
        nullptr, mon_event_cb, g_monPid, 0, WINEVENT_OUTOFCONTEXT);
    if (hk) {
        MSG msg; DWORD t0 = GetTickCount();
        while (GetTickCount() - t0 < 8000) {
            DWORD rem = 8000 - (GetTickCount() - t0);
            if (MsgWaitForMultipleObjects(0, nullptr, FALSE, rem, QS_ALLINPUT) == WAIT_TIMEOUT) break;
            while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
                if (msg.message == WM_QUIT) goto done;
                DispatchMessage(&msg);
            }
        }
        done:
        UnhookWinEvent(hk);
    }
    CoUninitialize();
    return 0;
}

static void start_panel_monitor(void) {
    g_monPid = GetCurrentProcessId();
    g_monSnapN = 0;
    EnumWindows(mon_snap_cb, 0);
    HANDLE h = CreateThread(nullptr, 0, mon_thread_func, nullptr, 0, nullptr);
    if (h) CloseHandle(h);
}

static DWORD WINAPI panel_thread_func(void *arg) {
    PanelArg *pa = (PanelArg *)arg;
    char clsidStr[64];
    strncpy(clsidStr, pa->clsid, sizeof(clsidStr) - 1);
    clsidStr[sizeof(clsidStr) - 1] = '\0';
    free(pa);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    bool comInit = SUCCEEDED(hr) || hr == (HRESULT)S_FALSE;

    auto cleanup = [&](DWORD ret) -> DWORD {
        if (comInit) CoUninitialize();
        return ret;
    };

    start_panel_monitor();

    if (g_asio) {
        g_asio->controlPanel();
        return cleanup(0);
    }

    CLSID clsid; wchar_t wclsid[64];
    if (MultiByteToWideChar(CP_ACP, 0, clsidStr, -1, wclsid, 64) == 0 ||
        CLSIDFromString(wclsid, &clsid) != S_OK)
        return cleanup(1);

    IASIO *asio = nullptr;
    hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER,
                          clsid, reinterpret_cast<void **>(&asio));
    if (FAILED(hr)) return cleanup(1);

    if (!asio->init((void *)GetDesktopWindow())) {
        asio->Release(); return cleanup(1);
    }

    asio->controlPanel();

    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    asio->Release();
    if (comInit) CoUninitialize();
    return 0;
}

void asio_open_control_panel(const char *clsidStr) {
    PanelArg *pa = (PanelArg *)malloc(sizeof(PanelArg));
    if (!pa) return;
    strncpy(pa->clsid, clsidStr, sizeof(pa->clsid) - 1);
    pa->clsid[sizeof(pa->clsid) - 1] = '\0';
    HANDLE h = CreateThread(nullptr, 0, panel_thread_func, pa, 0, nullptr);
    if (h) CloseHandle(h);
}
