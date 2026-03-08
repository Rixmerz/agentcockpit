# Go Concurrency Patterns

## Fan-Out/Fan-In
Distribute work across goroutines, merge results into single channel:
```go
func fanIn(ctx context.Context, channels ...<-chan Result) <-chan Result {
    var wg sync.WaitGroup
    merged := make(chan Result)
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for val := range c {
                select {
                case merged <- val:
                case <-ctx.Done(): return
                }
            }
        }(ch)
    }
    go func() { wg.Wait(); close(merged) }()
    return merged
}
```

## Worker Pool
N fixed workers consuming from shared queue:
```go
func processJobs(ctx context.Context, jobs []Job, numWorkers int) <-chan Result {
    jobsCh := make(chan Job)
    results := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobsCh { results <- job.Execute(ctx) }
        }()
    }
    go func() {
        for _, j := range jobs {
            select { case jobsCh <- j: case <-ctx.Done(): break }
        }
        close(jobsCh)
    }()
    go func() { wg.Wait(); close(results) }()
    return results
}
```

## Pipeline
Chained stages, each in its own goroutine:
```go
func generate(ctx context.Context, nums ...int) <-chan int { /* ... */ }
func square(ctx context.Context, in <-chan int) <-chan int { /* ... */ }
// Usage: for val := range square(ctx, generate(ctx, 2, 3, 4)) { ... }
```

## Semaphore (buffered channel)
```go
sem := make(chan struct{}, maxConcurrency)
for _, task := range tasks {
    sem <- struct{}{}
    go func(t Task) { defer func() { <-sem }(); t.Process() }(task)
}
```

## Context Cancellation
Every blocking goroutine MUST listen to `ctx.Done()`:
```go
select {
case <-ctx.Done(): return ctx.Err()
case result <- ch: // work
}
```

## errgroup
Structured concurrency with error propagation:
```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10) // max 10 concurrent goroutines
for _, url := range urls {
    g.Go(func() error { return fetch(ctx, url) })
}
if err := g.Wait(); err != nil { /* first error */ }
```

## Safety Rules

1. Every goroutine that can block MUST listen to `ctx.Done()`
2. Always `defer cancel()` for contexts
3. Close channels only from sender, exactly once
4. Use `sync.WaitGroup` or `errgroup` for completion
5. Detect leaks: `runtime.NumGoroutine()`, pprof, `uber-go/goleak`
6. Prefer worker pools over unlimited goroutine creation
7. Never start goroutines inside functions without making concurrency explicit to caller
