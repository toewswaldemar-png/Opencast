//go:build windows && !asio

package audio

// OpenASIOControlPanel is a no-op in the WASAPI-only build.
func OpenASIOControlPanel(clsid string) {}

// OpenASIOControlPanelSync is a no-op in the WASAPI-only build.
func OpenASIOControlPanelSync(clsid string) {}
