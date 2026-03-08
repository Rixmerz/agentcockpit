# PHP Frameworks & Libraries

## Web / API Frameworks

| Framework | Version | Type | Best For |
|-----------|---------|------|----------|
| Laravel | 12 | Full-stack | Rapid development, APIs, SaaS, startups |
| Symfony | 7.4 LTS | Full-stack | Enterprise, DDD, long-term support |
| Slim | 4 | Micro | Lightweight APIs, microservices |
| API Platform | 4.2 | API-first | REST/GraphQL from entities, auto-docs |
| FrankenPHP | 1.8 | App server | High-perf PHP server written in Go, worker mode |
| Mezzio (Laminas) | 3.x | Micro/PSR-15 | Middleware-based, PSR-compliant APIs |
| Laravel Zero | 11 | CLI | CLI applications with Laravel components |

## CMS Platforms

| CMS | Version | Architecture | Best For |
|-----|---------|-------------|----------|
| WordPress | 6.8 | Hooks/filters + REST API | Blogs, marketing sites, 43% of web |
| Drupal | 11 | Symfony-based, entity system | Enterprise CMS, government, universities |
| Statamic | 5 | Laravel-based, flat-file or DB | Developer-friendly CMS, content sites |
| Craft CMS | 5 | Yii2-based, element types | Custom content modeling, agencies |
| October CMS | 3 | Laravel-based, plugin system | Simple CMS with Laravel ecosystem |

## ORM / Database

| Library | Pattern | Best For |
|---------|---------|----------|
| Eloquent | Active Record | Laravel apps, rapid development |
| Doctrine ORM | Data Mapper | Symfony/enterprise, complex domains |
| Cycle ORM | Data Mapper | Framework-agnostic, Spiral apps |
| RedBeanPHP | Auto-schema | Prototyping, zero-config |
| PDO | Raw abstraction | Direct SQL, maximum control |

### Eloquent Relationships & Scopes

```php
// Model with relationships and scopes
class Post extends Model
{
    // Relationship: Post belongs to a User
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    // Relationship: Post has many Comments
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    // Relationship: Many-to-many with Tags
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class)->withTimestamps();
    }

    // Local scope: reusable query constraint
    public function scopePublished(Builder $query): Builder
    {
        return $query->whereNotNull('published_at')
                     ->where('published_at', '<=', now());
    }

    // Local scope with parameter
    public function scopeByAuthor(Builder $query, int $userId): Builder
    {
        return $query->where('author_id', $userId);
    }
}

// Usage
$posts = Post::published()->byAuthor(5)->with('tags')->paginate(20);
```

### Doctrine Entity with Attributes (PHP 8.1+)

```php
use Doctrine\ORM\Mapping as ORM;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;

#[ORM\Entity(repositoryClass: PostRepository::class)]
#[ORM\Table(name: 'posts')]
#[ORM\Index(columns: ['published_at'], name: 'idx_published')]
class Post
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(type: 'string', length: 255)]
    private string $title;

    #[ORM\Column(type: 'text')]
    private string $content;

    #[ORM\ManyToOne(targetEntity: User::class, inversedBy: 'posts')]
    #[ORM\JoinColumn(nullable: false)]
    private User $author;

    #[ORM\ManyToMany(targetEntity: Tag::class)]
    #[ORM\JoinTable(name: 'post_tags')]
    private Collection $tags;

    public function __construct(string $title, string $content, User $author)
    {
        $this->title = $title;
        $this->content = $content;
        $this->author = $author;
        $this->tags = new ArrayCollection();
    }

    public function getId(): ?int { return $this->id; }
    public function getTitle(): string { return $this->title; }
}
```

## HTTP / Auth

| Library | Purpose | Notes |
|---------|---------|-------|
| Guzzle 7 | HTTP client | PSR-7/18, middleware, async |
| Symfony HttpClient | HTTP client | Native Symfony, streaming, HTTP/2 |
| Laravel Sanctum | API auth | SPA + token auth, lightweight |
| Laravel Passport | OAuth2 | Full OAuth2 server |
| firebase/php-jwt | JWT | Encode/decode JWT tokens |
| league/oauth2-client | OAuth2 client | Social login, third-party OAuth |

## Messaging / Queues

| System | Framework | Features |
|--------|-----------|----------|
| Laravel Queues + Horizon | Laravel | Redis/SQS/DB drivers, dashboard, rate limiting |
| Symfony Messenger | Symfony | Message bus, transports (AMQP, Redis, Doctrine), middleware |
| php-amqplib | Any | Direct RabbitMQ integration |
| Enqueue | Any | Unified messaging abstraction, multiple transports |

## Testing

| Tool | Purpose | Notes |
|------|---------|-------|
| PHPUnit 11 | Unit/integration | Standard PHP testing framework |
| Pest PHP 3/4 | Unit/integration | Expressive syntax, built on PHPUnit |
| Mockery 1.6 | Mocking | Fluent mock API, spies, partial mocks |
| Laravel Dusk | Browser testing | ChromeDriver-based E2E for Laravel |
| Codeception 5 | Full-stack testing | Unit + functional + acceptance |
| Infection | Mutation testing | Measures test quality via mutations |
| ParaTest | Parallel PHPUnit | Run PHPUnit tests in parallel |

### Pest Test Syntax

```php
// Pest: expressive, closure-based
test('user can create a post', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post('/api/posts', [
        'title' => 'My Post',
        'content' => 'Hello world',
    ]);

    $response->assertCreated();
    expect($user->posts)->toHaveCount(1);
    expect($user->posts->first()->title)->toBe('My Post');
});

// Pest: datasets for parameterized tests
it('validates required fields', function (string $field) {
    $response = $this->postJson('/api/posts', [$field => '']);
    $response->assertJsonValidationErrorFor($field);
})->with(['title', 'content']);

// Pest: architectural testing
test('controllers do not use Eloquent directly')
    ->expect('App\Http\Controllers')
    ->not->toUse('Illuminate\Database\Eloquent');

// Pest: higher-order expectations
test('all users have valid emails', function () {
    $users = User::factory()->count(5)->create();
    expect($users)->each->email->toContain('@');
});
```

## Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| Composer 2.8 | Package manager | Autoloading, scripts, platform checks |
| PHPStan 2.0 | Static analysis | Levels 0-10, generics, custom rules |
| Psalm 5 | Static analysis | Taint analysis, type inference |
| Rector | Automated refactoring | PHP upgrades, pattern fixes |
| PHP-CS-Fixer | Code style | PSR-12, PER, custom rulesets |
| Xdebug 3 | Debugging/profiling | Step debug, profiling, coverage |
| Laravel Pint | Code style | Laravel's opinionated PHP-CS-Fixer wrapper |

## Async / Runtime

| Runtime | Type | Use Case |
|---------|------|----------|
| FrankenPHP | App server (Go) | Worker mode, Early Hints, Mercure, Caddy integration |
| Swoole | C extension | Coroutines, HTTP/WebSocket server, high concurrency |
| ReactPHP | Userland | Event loop, non-blocking I/O, streams |
| Amp v3 | Userland (Fibers) | Async/await via Fibers, concurrent I/O |
| RoadRunner | App server (Go) | Worker mode, gRPC, queues, KV |
| Laravel Octane | Adapter | Swoole/FrankenPHP/RoadRunner under Laravel |
