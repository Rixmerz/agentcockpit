# PHP Design Patterns (PHP 8.x)

## Builder Pattern — Fluent API

```php
declare(strict_types=1);

class QueryBuilder
{
    private string $table = '';
    private array $conditions = [];
    private array $columns = ['*'];
    private ?int $limit = null;
    private ?string $orderBy = null;

    public static function table(string $table): static
    {
        $builder = new static();
        $builder->table = $table;
        return $builder;
    }

    public function select(string ...$columns): static
    {
        $this->columns = $columns;
        return $this;
    }

    public function where(string $column, string $operator, mixed $value): static
    {
        $this->conditions[] = compact('column', 'operator', 'value');
        return $this;
    }

    public function limit(int $limit): static
    {
        $this->limit = $limit;
        return $this;
    }

    public function orderBy(string $column, string $direction = 'ASC'): static
    {
        $this->orderBy = "{$column} {$direction}";
        return $this;
    }

    public function toSql(): string
    {
        $sql = 'SELECT ' . implode(', ', $this->columns) . " FROM {$this->table}";
        if ($this->conditions !== []) {
            $wheres = array_map(
                fn(array $c) => "{$c['column']} {$c['operator']} ?",
                $this->conditions,
            );
            $sql .= ' WHERE ' . implode(' AND ', $wheres);
        }
        if ($this->orderBy !== null) {
            $sql .= " ORDER BY {$this->orderBy}";
        }
        if ($this->limit !== null) {
            $sql .= " LIMIT {$this->limit}";
        }
        return $sql;
    }
}

// Usage
$query = QueryBuilder::table('users')
    ->select('id', 'name', 'email')
    ->where('status', '=', 'active')
    ->where('age', '>=', 18)
    ->orderBy('created_at', 'DESC')
    ->limit(10)
    ->toSql();
```

## Factory Method with Enums + Match

```php
declare(strict_types=1);

enum NotificationChannel: string
{
    case Email = 'email';
    case Sms = 'sms';
    case Push = 'push';
    case Slack = 'slack';
}

interface NotificationSender
{
    public function send(string $recipient, string $message): void;
}

class NotificationFactory
{
    public static function create(NotificationChannel $channel): NotificationSender
    {
        return match ($channel) {
            NotificationChannel::Email => new EmailSender(),
            NotificationChannel::Sms => new SmsSender(),
            NotificationChannel::Push => new PushSender(),
            NotificationChannel::Slack => new SlackSender(),
        };
    }
}

// Usage
$sender = NotificationFactory::create(NotificationChannel::Email);
$sender->send('user@example.com', 'Hello!');
```

## Singleton via DI Container (NOT static getInstance)

```php
declare(strict_types=1);

// WRONG: Classic singleton — hard to test, hidden dependency
class BadLogger
{
    private static ?self $instance = null;
    private function __construct() {}
    public static function getInstance(): self
    {
        return self::$instance ??= new self();
    }
}

// CORRECT: Register as singleton in DI container
// Laravel service provider
class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Resolves to the same instance every time
        $this->app->singleton(LoggerInterface::class, function (Application $app) {
            return new FileLogger(
                path: storage_path('logs/app.log'),
                level: config('logging.level'),
            );
        });
    }
}

// Symfony services.yaml equivalent
// services:
//     App\Logging\FileLogger:
//         arguments:
//             $path: '%kernel.logs_dir%/app.log'
//         # Symfony services are shared (singleton) by default
```

## Repository Pattern

```php
declare(strict_types=1);

// Interface (domain layer)
interface PostRepository
{
    public function findById(int $id): ?Post;
    public function findPublished(int $limit = 20, int $offset = 0): array;
    public function save(Post $post): void;
    public function delete(Post $post): void;
}

// Eloquent implementation (infrastructure layer)
class EloquentPostRepository implements PostRepository
{
    public function findById(int $id): ?Post
    {
        return Post::find($id);
    }

    public function findPublished(int $limit = 20, int $offset = 0): array
    {
        return Post::published()
            ->orderByDesc('published_at')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->all();
    }

    public function save(Post $post): void
    {
        $post->save();
    }

    public function delete(Post $post): void
    {
        $post->delete();
    }
}

// Bind in service provider
$this->app->bind(PostRepository::class, EloquentPostRepository::class);
```

## Facade Pattern (Laravel)

```php
declare(strict_types=1);

// How Laravel Facades work: static proxy to a container-resolved instance
class Cache extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'cache'; // Key in the service container
    }
}

// Usage: static calls are proxied via __callStatic
Cache::put('key', 'value', now()->addHour());
$value = Cache::get('key', 'default');

// Equivalent without facade:
app('cache')->put('key', 'value', now()->addHour());

// Real-time facades: prefix any class with "Facades\"
use Facades\App\Services\PaymentGateway;
PaymentGateway::charge($amount); // Resolves App\Services\PaymentGateway from container
```

## Observer with Laravel Events

```php
declare(strict_types=1);

// Event class
class OrderPlaced
{
    public function __construct(
        public readonly Order $order,
        public readonly User $customer,
    ) {}
}

// Listener
class SendOrderConfirmation
{
    public function __construct(
        private readonly MailService $mailer,
    ) {}

    public function handle(OrderPlaced $event): void
    {
        $this->mailer->send(
            to: $event->customer->email,
            template: 'order-confirmation',
            data: ['order' => $event->order],
        );
    }
}

// Registration in EventServiceProvider
protected $listen = [
    OrderPlaced::class => [
        SendOrderConfirmation::class,
        UpdateInventory::class,
        NotifyWarehouse::class,
    ],
];

// Dispatch
OrderPlaced::dispatch($order, $customer);
// or: event(new OrderPlaced($order, $customer));
```

## Pipeline Pattern (Laravel Middleware)

```php
declare(strict_types=1);

// Using Laravel's Pipeline
use Illuminate\Pipeline\Pipeline;

$result = app(Pipeline::class)
    ->send($order)
    ->through([
        ValidateStock::class,
        ApplyDiscount::class,
        CalculateTax::class,
        ProcessPayment::class,
    ])
    ->thenReturn();

// Each stage implements handle()
class ApplyDiscount
{
    public function handle(Order $order, Closure $next): mixed
    {
        if ($order->coupon !== null) {
            $order->applyDiscount($order->coupon);
        }

        return $next($order);
    }
}
```

## Strategy with Enums (PHP 8.1+)

```php
declare(strict_types=1);

enum ShippingMethod: string
{
    case Standard = 'standard';
    case Express = 'express';
    case Overnight = 'overnight';

    public function calculator(): ShippingCalculator
    {
        return match ($this) {
            self::Standard => new StandardShipping(),
            self::Express => new ExpressShipping(),
            self::Overnight => new OvernightShipping(),
        };
    }

    public function estimatedDays(): int
    {
        return match ($this) {
            self::Standard => 7,
            self::Express => 3,
            self::Overnight => 1,
        };
    }

    public function calculate(float $weight, float $distance): float
    {
        return $this->calculator()->calculate($weight, $distance);
    }
}

interface ShippingCalculator
{
    public function calculate(float $weight, float $distance): float;
}

// Usage
$cost = ShippingMethod::Express->calculate(weight: 2.5, distance: 150.0);
$days = ShippingMethod::Express->estimatedDays(); // 3
```

## Value Object with Readonly Class (PHP 8.2+)

```php
declare(strict_types=1);

readonly class Money
{
    public function __construct(
        public int $amount,      // In cents
        public Currency $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException('Amount cannot be negative');
        }
    }

    public function add(self $other): self
    {
        if ($this->currency !== $other->currency) {
            throw new CurrencyMismatchException();
        }
        return new self($this->amount + $other->amount, $this->currency);
    }

    public function multiply(int $factor): self
    {
        return new self($this->amount * $factor, $this->currency);
    }

    public function format(): string
    {
        return number_format($this->amount / 100, 2) . ' ' . $this->currency->value;
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount
            && $this->currency === $other->currency;
    }
}

enum Currency: string
{
    case USD = 'USD';
    case EUR = 'EUR';
    case GBP = 'GBP';
}

// Usage
$price = new Money(1999, Currency::USD);
$total = $price->multiply(3); // 5997 cents = $59.97
```

## DTO with Constructor Promotion + Named Arguments

```php
declare(strict_types=1);

readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
        public ?string $phone = null,
        public string $role = 'user',
        public array $metadata = [],
    ) {}

    public static function fromRequest(Request $request): self
    {
        return new self(
            name: $request->validated('name'),
            email: $request->validated('email'),
            password: $request->validated('password'),
            phone: $request->validated('phone'),
            role: $request->validated('role', 'user'),
            metadata: $request->validated('metadata', []),
        );
    }

    public static function fromArray(array $data): self
    {
        return new self(
            name: $data['name'],
            email: $data['email'],
            password: $data['password'],
            phone: $data['phone'] ?? null,
            role: $data['role'] ?? 'user',
        );
    }
}

// Usage with named arguments for clarity
$dto = new CreateUserDTO(
    name: 'Alice',
    email: 'alice@example.com',
    password: 'securepass',
    role: 'admin',
);
```

## Result Pattern (Explicit Success/Failure)

```php
declare(strict_types=1);

readonly class Result
{
    private function __construct(
        public bool $success,
        public mixed $value = null,
        public ?string $error = null,
        public ?string $errorCode = null,
    ) {}

    public static function ok(mixed $value = null): self
    {
        return new self(success: true, value: $value);
    }

    public static function fail(string $error, ?string $code = null): self
    {
        return new self(success: false, error: $error, errorCode: $code);
    }

    public function map(callable $fn): self
    {
        if (!$this->success) {
            return $this;
        }
        return self::ok($fn($this->value));
    }

    public function flatMap(callable $fn): self
    {
        if (!$this->success) {
            return $this;
        }
        return $fn($this->value);
    }

    public function getOrElse(mixed $default): mixed
    {
        return $this->success ? $this->value : $default;
    }
}

// Usage
class PaymentService
{
    public function charge(Money $amount, string $token): Result
    {
        try {
            $transaction = $this->gateway->charge($amount, $token);
            return Result::ok($transaction);
        } catch (InsufficientFundsException) {
            return Result::fail('Insufficient funds', 'INSUFFICIENT_FUNDS');
        } catch (InvalidTokenException) {
            return Result::fail('Invalid payment token', 'INVALID_TOKEN');
        }
    }
}

$result = $paymentService->charge($amount, $token);
if ($result->success) {
    $order->markPaid($result->value->id);
} else {
    logger()->warning("Payment failed: {$result->error}", ['code' => $result->errorCode]);
}
```
