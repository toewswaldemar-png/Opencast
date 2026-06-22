FROM golang:1.22-alpine AS builder
WORKDIR /app

COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download

COPY server/ ./server/
COPY frontend/dist ./server/dist/

RUN cd server && CGO_ENABLED=0 GOOS=linux go build -o ../opencast-server .

FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/opencast-server .

EXPOSE 8765

ENV PORT=8765
ENV BASE_URL=""

CMD ["./opencast-server"]
