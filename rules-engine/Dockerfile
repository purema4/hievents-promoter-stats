# The rules engine (cel-go). Built and tested here; the final image is the static binary alone.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
# The engine's own tests run on every build: an image is only made from code that passes them.
RUN go vet ./... && go test -count=1 ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /rules-engine .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /rules-engine /rules-engine
USER nonroot
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD ["/rules-engine", "-health"]
ENTRYPOINT ["/rules-engine"]
