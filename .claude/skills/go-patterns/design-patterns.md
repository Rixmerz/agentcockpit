# Go Design Patterns

## Functional Options (Rob Pike / Dave Cheney)
```go
type Option func(*Server)
func WithPort(p int) Option { return func(s *Server) { s.port = p } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{host: addr, port: 8080, timeout: 30 * time.Second}
    for _, opt := range opts { opt(s) }
    return s
}
```
Rule: required params are explicit args, optional params are Options.

## Repository Pattern
Interfaces defined at consumer, not provider. Implicit satisfaction:
```go
type UserRepository interface {
    GetByID(ctx context.Context, id string) (*User, error)
    Store(ctx context.Context, user *User) error
}
type postgresUserRepo struct { pool *pgxpool.Pool }
// Satisfies UserRepository implicitly
```

## Error Handling: Three Patterns
```go
// Sentinel errors
var ErrNotFound = errors.New("not found")
if errors.Is(err, ErrNotFound) { /* ... */ }

// Error wrapping (1.13+)
return fmt.Errorf("fetching user %s: %w", id, err)

// Custom error types
type ValidationError struct { Field, Message string }
func (e *ValidationError) Error() string { /* ... */ }
var ve *ValidationError
if errors.As(err, &ve) { /* ... */ }
```

## Composition over Inheritance
```go
type Logger struct { /* ... */ }
func (l *Logger) Log(msg string) { /* ... */ }
type Server struct {
    Logger  // embedding: Server.Log() promoted
    router *http.ServeMux
}
```

## Table-Driven Tests
```go
tests := []struct{ name string; input string; want int; wantErr bool }{
    {"valid", "42.50", 4250, false},
    {"invalid", "abc", 0, true},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) { /* ... */ })
}
```

## Zero Value Design
Design structs so zero value is useful:
- `sync.Mutex` ready to use without initialization
- `bytes.Buffer` is functional as empty buffer
- Avoid constructors when zero value works

## Interface Design
Rob Pike: "The bigger the interface, the weaker the abstraction."
- 1-3 methods preferred
- Compose small interfaces: `type ReadWriter interface { Reader; Writer }`
- Define at consumer, not provider
- Don't create interfaces before concrete types exist

## Anti-Patterns to Flag

| Anti-Pattern | Fix |
|-------------|-----|
| Goroutine leak (blocked without exit) | Listen to `ctx.Done()` in select |
| Hidden `go func()` inside functions | Make concurrency explicit to caller |
| Interface pollution (1 impl "just in case") | Use concrete type, create interface when needed |
| OOP forced in Go (deep embedding, getters/setters) | Simple structs, exported fields |
| Single struct with json+gorm+validate tags | Separate models per concern with mapping functions |
| Generic package names (`util`, `helpers`, `common`) | Descriptive names for what packages DO |
| Error without context (`return err`) | `return fmt.Errorf("operation X: %w", err)` |
| `panic` in library code | Return errors, never panic |
| Forgetting `defer mu.Unlock()` | Always defer immediately after Lock() |
| Barrel imports causing circular deps | Direct imports |
