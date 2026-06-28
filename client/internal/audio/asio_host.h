#ifndef ASIO_HOST_H
#define ASIO_HOST_H

#ifdef __cplusplus
extern "C" {
#endif

#include <windows.h>
#include <stdint.h>

/* One registry entry under HKLM\SOFTWARE\ASIO */
typedef struct {
    char name[256];
    char clsid[64];
} ASIORegEntry;

int  asio_enumerate_drivers(ASIORegEntry *drivers, int maxDrivers);
int  asio_open_driver(const char *clsidStr, char *errBuf, int errLen);
int  asio_get_driver_info(long *numInputCh, double *defSampleRate, char *errBuf, int errLen);
/* Probe without keeping the driver open. Skips safely if a driver is already active. */
int  asio_probe_driver(const char *clsidStr, long *numInputCh, double *sampleRate);
long asio_get_preferred_buffer_size(void);
int  asio_start_capture(int *channels, int numChannels, long bufferSize,
                        double sampleRate, double *outActualSampleRate,
                        char *errBuf, int errLen);
void asio_stop(void);
void asio_run_message_pump(void);
void asio_release_driver(void);
void asio_open_control_panel(const char *clsidStr);
/* Like asio_open_control_panel but blocks until the panel window is closed. */
void asio_open_control_panel_sync(const char *clsidStr);

#ifdef __cplusplus
}
#endif

#endif /* ASIO_HOST_H */
