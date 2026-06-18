/*
 * asio_host.c — Native ASIO COM host for Windows
 *
 * Implements the IASIO interface by replicating the public vtable layout
 * documented in the ASIO 2.3 specification.  No Steinberg SDK required;
 * only MinGW (GCC for Windows) is needed.
 *
 * Drivers are discovered from HKLM\SOFTWARE\ASIO and instantiated via
 * CoCreateInstance with the IID_IASIO COM interface.
 */

#include "asio_host.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

/* ------------------------------------------------------------------ */
/* ASIO type definitions (from public ASIO 2.3 spec)                  */
/* ------------------------------------------------------------------ */

typedef double      ASIOSampleRate;
typedef long        ASIOBool;
typedef long        ASIOError;
typedef int64_t     ASIOSamples;
typedef int64_t     ASIOTimeStamp;

#define ASIOTrue  1
#define ASIOFalse 0

/* ASIOError values */
#define ASE_OK              0L
#define ASE_SUCCESS         0x3f4847a0L

/* ASIOSampleType — most common formats only */
#define ASIOSTInt16MSB      0
#define ASIOSTInt24MSB      1
#define ASIOSTInt32MSB      2
#define ASIOSTFloat32MSB    3
#define ASIOSTInt32LSB      8
#define ASIOSTInt24LSB      9
#define ASIOSTFloat32LSB   10
#define ASIOSTFloat64LSB   11
#define ASIOSTInt16LSB     16

/* ASIOMessageSelector */
#define kAsioSelectorSupported  1
#define kAsioEngineVersion      2
#define kAsioResetRequest       3
#define kAsioBufferSizeChange   4
#define kAsioResyncRequest      5
#define kAsioLatenciesChanged   6
#define kAsioSupportsTimeInfo   7
#define kAsioSupportsTimeCode   8

typedef struct {
    long        channel;
    ASIOBool    isInput;
    ASIOBool    isActive;
    long        channelGroup;
    long        type;   /* ASIOSampleType */
    char        name[32];
} ASIOChannelInfo;

typedef struct {
    ASIOBool    isInput;
    long        channelNum;
    void       *buffers[2];
} ASIOBufferInfo;

typedef struct {
    double          speed;
    ASIOSamples     timeCodeSamples;
    unsigned long   flags;
    char            future[64];
} ASIOTimeCode;

typedef struct {
    double          speed;
    ASIOTimeStamp   systemTime;
    ASIOSamples     samplePosition;
    ASIOSampleRate  sampleRate;
    unsigned long   flags;
    char            reserved[12];
} ASIOTimeInfo;

typedef struct {
    long            reserved[4];
    ASIOTimeInfo    timeInfo;
    ASIOTimeCode    timeCode;
} ASIOTime;

typedef struct {
    void       (*bufferSwitch)(long doubleBufferIndex, ASIOBool directProcess);
    void       (*sampleRateDidChange)(ASIOSampleRate sRate);
    long       (*asioMessage)(long selector, long value, void *message, double *opt);
    ASIOTime  *(*bufferSwitchTimeInfo)(ASIOTime *params, long doubleBufferIndex, ASIOBool directProcess);
} ASIOCallbacks;

/* ------------------------------------------------------------------ */
/* IASIO COM interface (vtable from public ASIO spec)                 */
/* ------------------------------------------------------------------ */

typedef struct IASIO_s IASIO;

typedef struct {
    /* IUnknown */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(IASIO *This, REFIID riid, void **ppv);
    ULONG   (STDMETHODCALLTYPE *AddRef)(IASIO *This);
    ULONG   (STDMETHODCALLTYPE *Release)(IASIO *This);
    /* IASIO — cdecl (same as default on x64) */
    ASIOBool  (*init)(IASIO *This, void *sysHandle);
    void      (*getDriverName)(IASIO *This, char *name);
    long      (*getDriverVersion)(IASIO *This);
    void      (*getErrorMessage)(IASIO *This, char *string);
    ASIOError (*start)(IASIO *This);
    ASIOError (*stop)(IASIO *This);
    ASIOError (*getChannels)(IASIO *This, long *numInputCh, long *numOutputCh);
    ASIOError (*getLatencies)(IASIO *This, long *inputLatency, long *outputLatency);
    ASIOError (*getBufferSize)(IASIO *This, long *minSize, long *maxSize,
                               long *preferredSize, long *granularity);
    ASIOError (*canSampleRate)(IASIO *This, ASIOSampleRate sampleRate);
    ASIOError (*getSampleRate)(IASIO *This, ASIOSampleRate *sampleRate);
    ASIOError (*setSampleRate)(IASIO *This, ASIOSampleRate sampleRate);
    ASIOError (*getClockSources)(IASIO *This, void *clocks, long *numSources);
    ASIOError (*setClockSource)(IASIO *This, long reference);
    ASIOError (*getSamplePosition)(IASIO *This, ASIOSamples *sPos, ASIOTimeStamp *tStamp);
    ASIOError (*getChannelInfo)(IASIO *This, ASIOChannelInfo *info);
    ASIOError (*createBuffers)(IASIO *This, ASIOBufferInfo *bufferInfos,
                               long numChannels, long bufferSize, ASIOCallbacks *callbacks);
    ASIOError (*disposeBuffers)(IASIO *This);
    ASIOError (*controlPanel)(IASIO *This);
    ASIOError (*future)(IASIO *This, long selector, void *opt);
    ASIOError (*outputReady)(IASIO *This);
} IASIOVtbl;

struct IASIO_s {
    IASIOVtbl *lpVtbl;
};

/* IID_IASIO = {8F97B4C1-33A2-11d3-8CD0-00A0C98A67AD} */
static const IID IID_IASIO = {
    0x8F97B4C1, 0x33A2, 0x11d3,
    {0x8C, 0xD0, 0x00, 0xA0, 0xC9, 0x8A, 0x67, 0xAD}
};

/* ------------------------------------------------------------------ */
/* Global ASIO state (only one driver open at a time)                 */
/* ------------------------------------------------------------------ */

#define MAX_ASIO_CHANNELS 32

static IASIO         *g_asio        = NULL;
static ASIOBufferInfo g_bufInfos[MAX_ASIO_CHANNELS];
static long           g_bufferSize  = 0;
static long           g_sampleType  = ASIOSTInt32LSB;
static int            g_numChannels = 0;
static HANDLE         g_stopEvent   = NULL;

/* Forward declaration of the Go callback */
extern void goAsioBufferCallback(void *data, int numFrames, int sampleType, int numChannels);

/* ------------------------------------------------------------------ */
/* ASIO callback implementations                                      */
/* ------------------------------------------------------------------ */

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

/* Convert one ASIO sample to int16 */
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
        int32_t v = ((int32_t)b[2] << 24) | ((int32_t)b[1] << 16) | ((int32_t)b[0] << 8);
        return (int16_t)(v >> 16);
    }
    case ASIOSTInt32MSB: {
        int32_t raw = ((const int32_t *)buf)[frame];
        /* byte-swap */
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
        /* Best-effort: treat as INT32LSB */
        int32_t v = ((const int32_t *)buf)[frame];
        return (int16_t)(v >> 16);
    }
    }
}

/* bufferSwitch — called by the ASIO driver when a buffer is ready */
static void asio_buffer_switch(long idx, ASIOBool directProcess) {
    (void)directProcess;
    if (!g_asio || g_numChannels == 0 || g_bufferSize == 0)
        return;

    /* Build interleaved s16le output */
    int total   = g_numChannels * (int)g_bufferSize;
    int16_t *out = (int16_t *)malloc((size_t)total * sizeof(int16_t));
    if (!out) return;

    for (long frame = 0; frame < g_bufferSize; frame++) {
        for (int ch = 0; ch < g_numChannels; ch++) {
            void *buf = g_bufInfos[ch].buffers[idx];
            int16_t s = buf ? asio_sample_to_i16(g_sampleType, buf, frame) : 0;
            out[frame * g_numChannels + ch] = s;
        }
    }

    goAsioBufferCallback(out, (int)g_bufferSize, (int)g_sampleType, g_numChannels);
    free(out);
}

static void asio_sample_rate_changed(ASIOSampleRate sRate) {
    (void)sRate; /* ignored */
}

static long asio_message(long selector, long value, void *message, double *opt) {
    (void)message; (void)opt;
    switch (selector) {
    case kAsioSelectorSupported:
        return (value == kAsioEngineVersion ||
                value == kAsioResetRequest  ||
                value == kAsioLatenciesChanged) ? 1L : 0L;
    case kAsioEngineVersion:
        return 2L;
    case kAsioResetRequest:
        return 1L; /* accepted but not acted upon */
    case kAsioSupportsTimeInfo:
        return 1L; /* use bufferSwitchTimeInfo; some drivers (e.g. ReaRoute) require this */
    case kAsioSupportsTimeCode:
        return 0L;
    default:
        return 0L;
    }
}

static ASIOTime *asio_buffer_switch_time_info(ASIOTime *params, long idx, ASIOBool directProcess) {
    asio_buffer_switch(idx, directProcess);
    return params;
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

int asio_enumerate_drivers(ASIODriverInfo *drivers, int maxDrivers) {
    HKEY hRoot;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\ASIO", 0, KEY_READ, &hRoot) != ERROR_SUCCESS)
        return 0;

    int    count = 0;
    DWORD  idx   = 0;
    char   subKey[256];
    DWORD  subKeyLen;

    while (count < maxDrivers) {
        subKeyLen = sizeof(subKey);
        LONG ret  = RegEnumKeyExA(hRoot, idx++, subKey, &subKeyLen, NULL, NULL, NULL, NULL);
        if (ret == ERROR_NO_MORE_ITEMS) break;
        if (ret != ERROR_SUCCESS)       continue;

        HKEY hDrv;
        if (RegOpenKeyExA(hRoot, subKey, 0, KEY_READ, &hDrv) != ERROR_SUCCESS) continue;

        char  clsidStr[64] = {0};
        DWORD clsidLen = sizeof(clsidStr);
        DWORD type;
        LONG  qr = RegQueryValueExA(hDrv, "CLSID", NULL, &type, (LPBYTE)clsidStr, &clsidLen);
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

    /* Parse CLSID string */
    CLSID  clsid;
    wchar_t wclsid[64];
    if (MultiByteToWideChar(CP_ACP, 0, clsidStr, -1, wclsid, 64) == 0) {
        snprintf(errBuf, errLen, "MultiByteToWideChar failed");
        return -1;
    }
    if (CLSIDFromString(wclsid, &clsid) != S_OK) {
        snprintf(errBuf, errLen, "ungueltige CLSID: %s", clsidStr);
        return -1;
    }

    /* COM init on the calling thread */
    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE && hr != (HRESULT)S_FALSE) {
        snprintf(errBuf, errLen, "CoInitializeEx: 0x%08X", (unsigned)hr);
        return -1;
    }

    /* ASIO quirk: riid must be the driver's own CLSID, not a fixed IID_IASIO */
    hr = CoCreateInstance(&clsid, NULL, CLSCTX_INPROC_SERVER, &clsid, (void **)&g_asio);
    if (FAILED(hr)) {
        snprintf(errBuf, errLen, "CoCreateInstance: 0x%08X", (unsigned)hr);
        CoUninitialize();
        return -1;
    }

    if (!g_asio->lpVtbl->init(g_asio, (void *)GetDesktopWindow())) {
        char drvErr[256] = {0};
        g_asio->lpVtbl->getErrorMessage(g_asio, drvErr);
        snprintf(errBuf, errLen, "ASIO init() fehlgeschlagen: %s", drvErr);
        g_asio->lpVtbl->Release(g_asio);
        g_asio = NULL;
        CoUninitialize();
        return -1;
    }

    return 0;
}

int asio_get_driver_info(long *numInputCh, double *defSampleRate, char *errBuf, int errLen) {
    if (!g_asio) { snprintf(errBuf, errLen, "kein Treiber geoeffnet"); return -1; }

    long numOut = 0;
    ASIOError err = g_asio->lpVtbl->getChannels(g_asio, numInputCh, &numOut);
    if (err != ASE_OK) {
        snprintf(errBuf, errLen, "getChannels Fehler: %ld", err);
        return -1;
    }

    ASIOSampleRate sr = 48000.0;
    g_asio->lpVtbl->getSampleRate(g_asio, &sr);
    *defSampleRate = sr;
    return 0;
}

long asio_get_preferred_buffer_size(void) {
    if (!g_asio) return 512;
    long minSz, maxSz, prefSz, gran;
    ASIOError err = g_asio->lpVtbl->getBufferSize(g_asio, &minSz, &maxSz, &prefSz, &gran);
    return (err == ASE_OK) ? prefSz : 512;
}

int asio_start_capture(int *channels, int numChannels, long bufferSize,
                       double sampleRate, char *errBuf, int errLen) {
    if (!g_asio) { snprintf(errBuf, errLen, "kein Treiber geoeffnet"); return -1; }
    if (numChannels > MAX_ASIO_CHANNELS) numChannels = MAX_ASIO_CHANNELS;

    /* Try to set requested sample rate; if unsupported (e.g. ReaRoute locked to
     * Reaper's project rate), confirm the driver's current rate explicitly.
     * Some virtual ASIO drivers require an explicit setSampleRate call before
     * they will deliver bufferSwitch callbacks. */
    ASIOError err = g_asio->lpVtbl->canSampleRate(g_asio, (ASIOSampleRate)sampleRate);
    if (err == ASE_OK || err == ASE_SUCCESS) {
        g_asio->lpVtbl->setSampleRate(g_asio, (ASIOSampleRate)sampleRate);
    } else {
        ASIOSampleRate actualSR = 48000.0;
        g_asio->lpVtbl->getSampleRate(g_asio, &actualSR);
        g_asio->lpVtbl->setSampleRate(g_asio, actualSR);
    }

    /* Prepare buffer infos */
    memset(g_bufInfos, 0, sizeof(g_bufInfos));
    for (int i = 0; i < numChannels; i++) {
        g_bufInfos[i].isInput    = ASIOTrue;
        g_bufInfos[i].channelNum = (long)channels[i];
    }

    err = g_asio->lpVtbl->createBuffers(g_asio, g_bufInfos, (long)numChannels,
                                        bufferSize, &g_callbacks);
    if (err != ASE_OK) {
        snprintf(errBuf, errLen, "createBuffers Fehler: %ld", err);
        return -1;
    }

    /* Detect sample type from first input channel */
    ASIOChannelInfo chInfo;
    memset(&chInfo, 0, sizeof(chInfo));
    chInfo.channel = (long)channels[0];
    chInfo.isInput = ASIOTrue;
    err = g_asio->lpVtbl->getChannelInfo(g_asio, &chInfo);
    g_sampleType  = (err == ASE_OK) ? chInfo.type : (long)ASIOSTInt32LSB;
    g_bufferSize  = bufferSize;
    g_numChannels = numChannels;

    err = g_asio->lpVtbl->start(g_asio);
    if (err != ASE_OK) {
        g_numChannels = 0;
        g_bufferSize  = 0;
        g_asio->lpVtbl->disposeBuffers(g_asio);
        snprintf(errBuf, errLen, "ASIO start() Fehler: %ld", err);
        return -1;
    }

    /* Manual-reset event — stays signaled so any late SetEvent calls are harmless */
    g_stopEvent = CreateEventA(NULL, TRUE, FALSE, NULL);
    if (!g_stopEvent) {
        g_asio->lpVtbl->stop(g_asio);
        g_asio->lpVtbl->disposeBuffers(g_asio);
        g_numChannels = 0;
        g_bufferSize  = 0;
        snprintf(errBuf, errLen, "CreateEvent fehlgeschlagen");
        return -1;
    }

    return 0;
}

/* Signal the message pump to exit. Safe to call from any thread. */
void asio_stop(void) {
    if (g_stopEvent) SetEvent(g_stopEvent);
}

/*
 * Run a Windows message pump on the calling thread until asio_stop() signals
 * g_stopEvent. Performs the actual ASIO stop()/disposeBuffers() after exit so
 * that any pending COM cross-apartment messages are processed first.
 * Must be called from the locked OS thread that owns the ASIO STA apartment.
 */
void asio_run_message_pump(void) {
    if (!g_stopEvent) return;
    MSG msg;
    while (1) {
        DWORD r = MsgWaitForMultipleObjects(1, &g_stopEvent, FALSE, INFINITE, QS_ALLINPUT);
        if (r == WAIT_OBJECT_0) break;           /* stop event signaled */
        if (r == WAIT_OBJECT_0 + 1) {           /* Windows message ready */
            while (PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
                if (msg.message == WM_QUIT) goto cleanup;
                TranslateMessage(&msg);
                DispatchMessage(&msg);
            }
        }
    }
cleanup:
    if (g_asio) {
        g_asio->lpVtbl->stop(g_asio);
        g_asio->lpVtbl->disposeBuffers(g_asio);
    }
    g_numChannels = 0;
    g_bufferSize  = 0;
    CloseHandle(g_stopEvent);
    g_stopEvent = NULL;
}

int asio_probe_driver(const char *clsidStr, long *numInputCh, double *sampleRate) {
    /* Skip if a capture session is already using the driver */
    if (g_asio) {
        *numInputCh = 0;
        *sampleRate = 0;
        return -1;
    }
    char errBuf[256];
    if (asio_open_driver(clsidStr, errBuf, sizeof(errBuf)) != 0) return -1;
    int ret = asio_get_driver_info(numInputCh, sampleRate, errBuf, sizeof(errBuf));
    asio_release_driver();
    return ret;
}

void asio_release_driver(void) {
    if (!g_asio) return;
    g_asio->lpVtbl->Release(g_asio);
    g_asio = NULL;
    if (g_stopEvent) { CloseHandle(g_stopEvent); g_stopEvent = NULL; }
    CoUninitialize();
}

/* ------------------------------------------------------------------ */
/* Control panel — runs on its own STA thread so it never blocks Go   */
/* ------------------------------------------------------------------ */

typedef struct { char clsid[64]; } PanelArg;

static DWORD WINAPI panel_thread_func(void *arg) {
    PanelArg *pa = (PanelArg *)arg;

    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE && hr != (HRESULT)S_FALSE) {
        free(pa);
        return 1;
    }

    CLSID  clsid;
    wchar_t wclsid[64];
    MultiByteToWideChar(CP_ACP, 0, pa->clsid, -1, wclsid, 64);
    free(pa);

    if (CLSIDFromString(wclsid, &clsid) != S_OK) { CoUninitialize(); return 1; }

    IASIO *asio = NULL;
    hr = CoCreateInstance(&clsid, NULL, CLSCTX_INPROC_SERVER, &clsid, (void **)&asio);
    if (FAILED(hr)) { CoUninitialize(); return 1; }

    if (!asio->lpVtbl->init(asio, (void *)GetDesktopWindow())) {
        asio->lpVtbl->Release(asio);
        CoUninitialize();
        return 1;
    }

    asio->lpVtbl->controlPanel(asio);

    /* Pump messages until the panel posts WM_QUIT or no more messages */
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    asio->lpVtbl->Release(asio);
    CoUninitialize();
    return 0;
}

void asio_open_control_panel(const char *clsidStr) {
    PanelArg *pa = (PanelArg *)malloc(sizeof(PanelArg));
    if (!pa) return;
    strncpy(pa->clsid, clsidStr, sizeof(pa->clsid) - 1);
    pa->clsid[sizeof(pa->clsid) - 1] = '\0';
    HANDLE h = CreateThread(NULL, 0, panel_thread_func, pa, 0, NULL);
    if (h) CloseHandle(h); /* detach — thread owns its lifetime */
}
