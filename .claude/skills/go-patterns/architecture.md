# Go Architecture Patterns

## Clean Architecture (Go-adapted)
```
cmd/api/main.go              -> composition root
internal/
  domain/                     -> entities, business rules (no infra imports)
  service/                    -> use cases / application logic
  handler/                    -> HTTP/gRPC adapters
  repository/                 -> persistence implementations
```
Community consensus: use Clean Architecture **concepts** (dependency inversion, separation of concerns) but adapt structure to Go idioms. Don't rigidly follow Uncle Bob's layers.

## Hexagonal (Ports & Adapters)
Natural fit for Go thanks to implicit interfaces:
```go
// Port (domain interface)
type OrderRepository interface { Save(ctx context.Context, order *Order) error }
// Adapter (infra)
type PostgresOrderRepo struct { pool *pgxpool.Pool }
// Service (depends only on port)
type OrderService struct { repo OrderRepository }
```

## Vertical Slice
```
features/create-user/ -> command, handler, controller, validator, test
features/get-user/    -> query, handler, test
```

## Project Layout
**`golang-standards/project-layout` is controversial** — NOT affiliated with the Go team. Russ Cox: "This is not a standard Go project layout."

Pragmatic recommendation:
- `cmd/` for multiple binaries
- `internal/` for private packages (enforced by toolchain)
- Keep everything else flat. Add structure only when needed

## DDD + gRPC Microservices
- **ThreeDotsLabs/wild-workouts-go-ddd-example**: Best DDD + Clean + CQRS reference
- **Watermill**: Event sourcing and CQRS with broker abstraction
- Hexagonal per microservice, gRPC as primary adapter, context propagation

## Best Practices

### context.Context
- Always first parameter: `func GetUser(ctx context.Context, id string) (*User, error)`
- NEVER store in a struct
- `context.WithValue` only for request-scoped data (trace IDs, auth tokens)

### Error Handling
- Always add context: `fmt.Errorf("querying user %s: %w", id, err)`
- `errors.Is()` for sentinels, `errors.As()` for custom types
- Never ignore errors silently. Prefer error over panic for expected failures
- `errors.Join` (1.20+) for combining multiple errors

### Performance
- Never optimize without profiling data. `pprof` first, optimize after
- `go test -bench=. -benchmem` for benchmarks
- `import _ "net/http/pprof"` for production profiling
- Go 1.24: `for b.Loop() { ... }` replaces `for range b.N`
