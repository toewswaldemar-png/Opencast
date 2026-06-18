.PHONY: all build frontend backend dev clean

# Build everything
all: build

build: frontend backend

# Build React frontend into backend/dist
frontend:
	cd frontend && npm install && npm run build

# Build Go binary (requires frontend/dist to exist)
backend:
	cd backend && go build -o opencast.exe .

# Run the complete app (build first, then serve)
run: build
	cd backend && ./opencast.exe

# Development mode: run Vite dev server + Go backend separately
dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && go run .

# Install npm dependencies
npm-install:
	cd frontend && npm install

# Download Go dependencies
go-tidy:
	cd backend && go mod tidy

# Clean build artifacts
clean:
	rm -f backend/opencast.exe
	rm -rf backend/dist

# Check that FFmpeg is in PATH
check-deps:
	@where ffmpeg || (echo "ERROR: ffmpeg not found in PATH. Install from https://ffmpeg.org/download.html" && exit 1)
	@echo "OK: ffmpeg found"
	@where go || (echo "ERROR: go not found" && exit 1)
	@echo "OK: go found"
	@where node || (echo "ERROR: node not found" && exit 1)
	@echo "OK: node found"
