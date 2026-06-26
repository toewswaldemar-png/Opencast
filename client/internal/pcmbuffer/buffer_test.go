package pcmbuffer_test

import (
	"testing"

	"client/internal/pcmbuffer"
)

const frameSize = 8

func TestReadFrame_Silence_WhenEmpty(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 4)
	dst := make([]byte, frameSize)
	for i := range dst {
		dst[i] = 0xFF
	}
	buf.ReadFrame(dst)
	for i, b := range dst {
		if b != 0 {
			t.Errorf("dst[%d] = %d, want 0 (silence)", i, b)
		}
	}
}

func TestWriteRead_Basic(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 4)
	src := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	buf.WriteFrame(src)

	if buf.Len() != 1 {
		t.Fatalf("Len = %d, want 1", buf.Len())
	}

	dst := make([]byte, frameSize)
	buf.ReadFrame(dst)
	for i, b := range dst {
		if b != src[i] {
			t.Errorf("dst[%d] = %d, want %d", i, b, src[i])
		}
	}
	if buf.Len() != 0 {
		t.Errorf("Len after Read = %d, want 0", buf.Len())
	}
}

func TestWriteRead_FIFO(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 4)
	for i := 0; i < 3; i++ {
		frame := make([]byte, frameSize)
		frame[0] = byte(i + 1)
		buf.WriteFrame(frame)
	}
	for i := 0; i < 3; i++ {
		dst := make([]byte, frameSize)
		buf.ReadFrame(dst)
		if dst[0] != byte(i+1) {
			t.Errorf("frame %d: got %d, want %d", i, dst[0], i+1)
		}
	}
}

func TestWriteFrame_DropOldest_OnOverflow(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 3)

	for i := byte(1); i <= 3; i++ {
		frame := make([]byte, frameSize)
		frame[0] = i
		buf.WriteFrame(frame)
	}
	// Buffer full [1,2,3]; write 4 → drops 1
	frame4 := make([]byte, frameSize)
	frame4[0] = 4
	buf.WriteFrame(frame4)

	if buf.Len() != 3 {
		t.Fatalf("Len = %d after overflow, want 3", buf.Len())
	}

	dst := make([]byte, frameSize)
	buf.ReadFrame(dst)
	if dst[0] != 2 {
		t.Errorf("first frame after overflow = %d, want 2 (1 was dropped)", dst[0])
	}
	buf.ReadFrame(dst)
	if dst[0] != 3 {
		t.Errorf("second frame = %d, want 3", dst[0])
	}
	buf.ReadFrame(dst)
	if dst[0] != 4 {
		t.Errorf("third frame = %d, want 4", dst[0])
	}
}

func TestReset_ClearsBuffer(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 4)
	buf.WriteFrame(make([]byte, frameSize))
	buf.WriteFrame(make([]byte, frameSize))
	buf.Reset()

	if buf.Len() != 0 {
		t.Errorf("Len after Reset = %d, want 0", buf.Len())
	}
	dst := make([]byte, frameSize)
	for i := range dst {
		dst[i] = 0xFF
	}
	buf.ReadFrame(dst)
	for i, b := range dst {
		if b != 0 {
			t.Errorf("dst[%d] = %d after Reset+Read, want 0 (silence)", i, b)
		}
	}
}

func TestCap_And_FrameSize(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 7)
	if buf.Cap() != 7 {
		t.Errorf("Cap = %d, want 7", buf.Cap())
	}
	if buf.FrameSize() != frameSize {
		t.Errorf("FrameSize = %d, want %d", buf.FrameSize(), frameSize)
	}
}

func TestWriteFrame_WrongSize_IsNoop(t *testing.T) {
	buf := pcmbuffer.New(frameSize, 4)
	buf.WriteFrame(make([]byte, frameSize+1))
	buf.WriteFrame(make([]byte, frameSize-1))
	if buf.Len() != 0 {
		t.Errorf("Len = %d after wrong-size writes, want 0", buf.Len())
	}
}

func TestOverflow_MultipleRounds(t *testing.T) {
	const cap = 4
	buf := pcmbuffer.New(frameSize, cap)

	// Write 2× capacity — only last `cap` frames should survive.
	for i := byte(0); i < cap*2; i++ {
		frame := make([]byte, frameSize)
		frame[0] = i
		buf.WriteFrame(frame)
	}

	if buf.Len() != cap {
		t.Fatalf("Len = %d, want %d", buf.Len(), cap)
	}

	// Oldest surviving frame = cap*2 - cap = cap
	for i := byte(cap); i < cap*2; i++ {
		dst := make([]byte, frameSize)
		buf.ReadFrame(dst)
		if dst[0] != i {
			t.Errorf("frame marker = %d, want %d", dst[0], i)
		}
	}
}
