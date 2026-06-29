# Stage 1: Frontend bauen
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Go-Server bauen
FROM golang:1.22-alpine AS builder
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=frontend /app/server/dist ./dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o opencast-server .

# Stage 3: Finales Image
FROM alpine:3.20
RUN apk add --no-cache ffmpeg ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server/opencast-server .

ENV PORT=8765
EXPOSE 8765

VOLUME ["/config"]
ENV XDG_CONFIG_HOME=/config

CMD ["./opencast-server"]
