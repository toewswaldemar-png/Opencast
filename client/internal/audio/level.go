package audio

import "math"

// ExtractChannelLevel computes L/R peak levels for one channel pair
// from multi-channel interleaved int16 PCM.
// posL and posR are 0-based slot indices within the channel interleaving
// (i.e. positions in the channels array passed to asio_start_capture).
func ExtractChannelLevel(pcm []int16, frames, numCh, posL, posR int) LevelUpdate {
	var peakL, peakR float64
	for f := 0; f < frames; f++ {
		base := f * numCh
		if posL < numCh {
			if v := absf16(pcm[base+posL]); v > peakL {
				peakL = v
			}
		}
		if posR < numCh {
			if v := absf16(pcm[base+posR]); v > peakR {
				peakR = v
			}
		}
	}
	if posL == posR {
		peakR = peakL // mono: copy L → R
	}
	return LevelUpdate{Left: toDBFS(peakL), Right: toDBFS(peakR)}
}

func absf16(s int16) float64 { return math.Abs(float64(s) / 32768.0) }

func toDBFS(v float64) float64 {
	if v < 1e-6 {
		return -120
	}
	return math.Max(-120, 20*math.Log10(v))
}
