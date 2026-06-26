package pcmbuffer

import "sync"

// PCMBuffer is a thread-safe ring buffer for fixed-size audio frames.
//
// Invariants:
//  1. ReadFrame always fills dst completely — silence (zeros) when empty.
//  2. WriteFrame never blocks and never fails; drops the oldest frame on overflow.
//  3. Buffer owns its memory; Write copies in, Read copies out.
//  4. No timers, sample rates, or encoder knowledge.
//  5. All operations work on complete frames of FrameSize bytes.
type PCMBuffer struct {
	frameSize int
	cap_      int
	buf       []byte
	writePos  int
	readPos   int
	count     int
	mu        sync.Mutex
}

// New creates a PCMBuffer with the given frame size (in bytes) and capacity (in frames).
func New(frameSize, capacityFrames int) *PCMBuffer {
	if frameSize <= 0 || capacityFrames <= 0 {
		panic("pcmbuffer: frameSize and capacityFrames must be positive")
	}
	return &PCMBuffer{
		frameSize: frameSize,
		cap_:      capacityFrames,
		buf:       make([]byte, frameSize*capacityFrames),
	}
}

func (b *PCMBuffer) FrameSize() int { return b.frameSize }
func (b *PCMBuffer) Cap() int       { return b.cap_ }

// Len returns the number of frames currently buffered.
func (b *PCMBuffer) Len() int {
	b.mu.Lock()
	n := b.count
	b.mu.Unlock()
	return n
}

// WriteFrame copies src into the buffer.
// src must be exactly FrameSize bytes.
// If the buffer is full, the oldest frame is dropped (Drop Oldest).
func (b *PCMBuffer) WriteFrame(src []byte) {
	if len(src) != b.frameSize {
		return
	}
	b.mu.Lock()
	if b.count == b.cap_ {
		b.readPos = (b.readPos + 1) % b.cap_
		b.count--
	}
	copy(b.buf[b.writePos*b.frameSize:], src)
	b.writePos = (b.writePos + 1) % b.cap_
	b.count++
	b.mu.Unlock()
}

// ReadFrame copies the next frame into dst.
// dst must be exactly FrameSize bytes.
// If the buffer is empty, dst is filled with zeros (silence).
func (b *PCMBuffer) ReadFrame(dst []byte) {
	if len(dst) != b.frameSize {
		return
	}
	b.mu.Lock()
	if b.count == 0 {
		b.mu.Unlock()
		clear(dst)
		return
	}
	copy(dst, b.buf[b.readPos*b.frameSize:])
	b.readPos = (b.readPos + 1) % b.cap_
	b.count--
	b.mu.Unlock()
}

// Reset discards all buffered frames.
func (b *PCMBuffer) Reset() {
	b.mu.Lock()
	b.writePos = 0
	b.readPos = 0
	b.count = 0
	b.mu.Unlock()
}
