.PHONY: all build frontend backend dev clean

# WinLibs GCC required for CGo (ASIO). Adjust path if installed elsewhere.
GCC_PATH ?= C:/Users/waldemar.toews/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin

# Default build tags: ASIO + WASAPI in one binary (requires GCC)
GO_TAGS := windows,asio

# Build everything
all: build

build: frontend backend

# Build React frontend into backend/dist
frontend:
	cd frontend && npm install && npm run build

# Build Go binary with ASIO support (CGo, requires GCC_PATH in PATH)
backend:
	cd backend && PATH="$(GCC_PATH):$(PATH)" go build -tags $(GO_TAGS) -o opencast.exe .

# Run the complete app (build first, then serve)
run: build
	cd backend && PATH="$(GCC_PATH):$(PATH)" ./opencast.exe

# Development mode: run Vite dev server + Go backend separately
dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && PATH="$(GCC_PATH):$(PATH)" go run -tags $(GO_TAGS) .

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

# Check that build tools are available
check-deps:
	@PATH="$(GCC_PATH):$(PATH)" gcc --version || (echo "ERROR: gcc not found — set GCC_PATH in Makefile" && exit 1)
	@echo "OK: gcc found"
	@where go || (echo "ERROR: go not found" && exit 1)
	@echo "OK: go found"
	@where node || (echo "ERROR: node not found" && exit 1)
	@echo "OK: node found"
