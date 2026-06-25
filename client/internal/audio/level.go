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

// ExtractStereoBytes extracts a 2-channel interleaved int16 LE []byte from a
// multi-channel PCM buffer. posL and posR are 0-based slot indices within numCh.
func ExtractStereoBytes(buf []byte, numCh, posL, posR int) []byte {
	if numCh < 1 || len(buf) == 0 {
		return nil
	}
	frameSize := numCh * 2
	frames := len(buf) / frameSize
	out := make([]byte, frames*4)
	for f := 0; f < frames; f++ {
		si := f * frameSize
		di := f * 4
		if posL < numCh {
			out[di+0] = buf[si+posL*2]
			out[di+1] = buf[si+posL*2+1]
		}
		if posR < numCh {
			out[di+2] = buf[si+posR*2]
			out[di+3] = buf[si+posR*2+1]
		}
	}
	if posL == posR {
		for f := 0; f < frames; f++ {
			out[f*4+2] = out[f*4+0]
			out[f*4+3] = out[f*4+1]
		}
	}
	return out
}

// LevelFromStereoBytes computes L/R peak levels from 2-channel interleaved int16 LE PCM bytes.
func LevelFromStereoBytes(b []byte) LevelUpdate {
	frames := len(b) / 4
	var peakL, peakR float64
	for f := 0; f < frames; f++ {
		l := int16(b[f*4]) | int16(b[f*4+1])<<8
		r := int16(b[f*4+2]) | int16(b[f*4+3])<<8
		if v := absf16(l); v > peakL {
			peakL = v
		}
		if v := absf16(r); v > peakR {
			peakR = v
		}
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
