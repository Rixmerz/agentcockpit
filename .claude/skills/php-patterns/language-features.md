# PHP Language Features

## PHP 8.4 (November 2024)

### Property Hooks

```php
declare(strict_types=1);

class User
{
    // Property hooks: computed/validated access without explicit getters/setters
    public string $name {
        set(string $value) => trim($value);
    }

    public string $fullName {
        get => "{$this->firstName} {$this->lastName}";
    }

    public string $email {
        set {
            if (!str_contains($value, '@')) {
                throw new InvalidArgumentException('Invalid email');
            }
            $this->email = strtolower($value);
        }
    }

    public function __construct(
        private string $firstName,
        private string $lastName,
    ) {}
}

$user = new User('John', 'Doe');
echo $user->fullName; // "John Doe"
$user->email = 'JOHN@EXAMPLE.COM'; // Stored as "john@example.com"
```

### Asymmetric Visibility

```php
declare(strict_types=1);

class BankAccount
{
    // Public read, private write
    public private(set) float $balance;

    // Public read, protected write (subclasses can modify)
    public protected(set) string $status = 'active';

    public function __construct(float $initialBalance)
    {
        $this->balance = $initialBalance;
    }

    public function deposit(float $amount): void
    {
        $this->balance += $amount; // OK: private(set) allows internal write
    }
}

$account = new BankAccount(100.0);
echo $account->balance;     // OK: public read
$account->balance = 500.0;  // Error: cannot set from outside
$account->deposit(50.0);    // OK: internal write
```

### Lazy Objects

```php
declare(strict_types=1);

// Proxy lazy object: delays initialization until first access
$reflector = new ReflectionClass(HeavyService::class);
$proxy = $reflector->newLazyProxy(function (): HeavyService {
    // Only called when a property/method is first accessed
    return new HeavyService(loadExpensiveConfig());
});

// Ghost lazy object: initializes in place
$ghost = $reflector->newLazyGhost(function (HeavyService $instance): void {
    $instance->__construct(loadExpensiveConfig());
});
```

### New Array Functions

```php
declare(strict_types=1);

$users = [
    ['name' => 'Alice', 'age' => 30],
    ['name' => 'Bob', 'age' => 25],
    ['name' => 'Charlie', 'age' => 35],
];

// array_find: returns first matching element
$found = array_find($users, fn($u) => $u['age'] > 28);
// ['name' => 'Alice', 'age' => 30]

// array_find_key: returns key of first match
$key = array_find_key($users, fn($u) => $u['name'] === 'Bob');
// 1

// array_any: true if any element matches
$hasMinor = array_any($users, fn($u) => $u['age'] < 18);
// false

// array_all: true if all elements match
$allAdults = array_all($users, fn($u) => $u['age'] >= 18);
// true
```

### #[\Deprecated] Attribute

```php
declare(strict_types=1);

class PaymentProcessor
{
    #[\Deprecated('Use processPayment() instead', since: '2.0')]
    public function charge(float $amount): void
    {
        $this->processPayment($amount);
    }

    public function processPayment(float $amount): void
    {
        // New implementation
    }
}
```

## PHP 8.3 (November 2023)

### Typed Class Constants

```php
declare(strict_types=1);

class Config
{
    public const string APP_NAME = 'MyApp';
    public const int MAX_RETRIES = 3;
    public const float TAX_RATE = 0.21;
    public const array ALLOWED_ROLES = ['admin', 'editor', 'viewer'];
}

interface HasVersion
{
    public const string VERSION = '1.0.0'; // Enforced in implementations
}
```

### json_validate()

```php
declare(strict_types=1);

// Before: had to attempt decode and check error
$data = json_decode($input);
if (json_last_error() !== JSON_ERROR_NONE) { /* invalid */ }

// After: fast validation without decoding
if (json_validate($input)) {
    $data = json_decode($input, associative: true);
}
```

### #[\Override] Attribute

```php
declare(strict_types=1);

class ParentClass
{
    public function process(): void {}
}

class ChildClass extends ParentClass
{
    #[\Override]
    public function process(): void
    {
        // If parent removes process(), this triggers a compile-time error
        parent::process();
    }

    #[\Override]
    public function prcess(): void {} // Compile error: no matching parent method (typo caught!)
}
```

### Readonly Deep-Cloning

```php
declare(strict_types=1);

readonly class Address
{
    public function __construct(
        public string $street,
        public string $city,
    ) {}

    // PHP 8.3: readonly classes can reinitialize properties during __clone
    public function withCity(string $city): self
    {
        $clone = clone $this;
        // In PHP 8.3, this is allowed inside __clone for readonly properties
        return $clone;
    }
}
```

## PHP 8.2 (December 2022)

### Readonly Classes

```php
declare(strict_types=1);

// All properties are implicitly readonly
readonly class Coordinate
{
    public function __construct(
        public float $latitude,
        public float $longitude,
    ) {}

    public function distanceTo(self $other): float
    {
        // Haversine formula
        $earthRadius = 6371;
        $dLat = deg2rad($other->latitude - $this->latitude);
        $dLon = deg2rad($other->longitude - $this->longitude);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($this->latitude))
            * cos(deg2rad($other->latitude)) * sin($dLon / 2) ** 2;
        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
```

### DNF Types (Disjunctive Normal Form)

```php
declare(strict_types=1);

// Combine intersection and union types
function process((Countable&Iterator)|null $items): int
{
    if ($items === null) {
        return 0;
    }
    return count($items);
}

function render((Stringable&JsonSerializable)|string $content): string
{
    if (is_string($content)) {
        return $content;
    }
    return (string) $content;
}
```

## PHP 8.1 (November 2021)

### Enums

```php
declare(strict_types=1);

// Basic enum
enum Suit
{
    case Hearts;
    case Diamonds;
    case Clubs;
    case Spades;
}

// Backed enum (string or int values)
enum Color: string
{
    case Red = '#FF0000';
    case Green = '#00FF00';
    case Blue = '#0000FF';

    // Methods on enums
    public function label(): string
    {
        return match ($this) {
            self::Red => 'Red',
            self::Green => 'Green',
            self::Blue => 'Blue',
        };
    }

    // From backed value
    // Color::from('#FF0000') => Color::Red
    // Color::tryFrom('#FFFFFF') => null
}

// Enums implementing interfaces
interface HasDescription
{
    public function description(): string;
}

enum Permission: string implements HasDescription
{
    case Read = 'read';
    case Write = 'write';
    case Admin = 'admin';

    public function description(): string
    {
        return match ($this) {
            self::Read => 'Can view resources',
            self::Write => 'Can create and edit resources',
            self::Admin => 'Full access to all resources',
        };
    }

    // All cases
    // Permission::cases() => [Permission::Read, Permission::Write, Permission::Admin]
}
```

### Fibers

```php
declare(strict_types=1);

// Fibers: interruptible functions (cooperative multitasking)
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('first');
    echo "Resumed with: {$value}\n";
    Fiber::suspend('second');
});

$result1 = $fiber->start();       // "first"
$result2 = $fiber->resume('hello'); // Prints "Resumed with: hello", returns "second"

// Fibers power async frameworks like Amp v3
// You rarely use Fiber directly — frameworks abstract it
```

### Intersection Types

```php
declare(strict_types=1);

function logAndCount(Countable&Stringable $items): void
{
    echo "Count: " . count($items) . ", Value: " . (string) $items;
}
```

## PHP 8.0 (November 2020)

### Union Types

```php
declare(strict_types=1);

function formatId(int|string $id): string
{
    return is_int($id) ? str_pad((string) $id, 8, '0', STR_PAD_LEFT) : $id;
}
```

### Match Expression

```php
declare(strict_types=1);

// match is strict (===), returns a value, no fallthrough
$result = match ($statusCode) {
    200 => 'OK',
    301, 302 => 'Redirect',
    404 => 'Not Found',
    500 => 'Server Error',
    default => 'Unknown',
};
```

### Named Arguments

```php
declare(strict_types=1);

// Skip optional parameters, self-documenting
array_slice(array: $items, offset: 2, length: 5, preserve_keys: true);

htmlspecialchars(string: $input, encoding: 'UTF-8', double_encode: false);
```

### Constructor Promotion

```php
declare(strict_types=1);

class Product
{
    public function __construct(
        private readonly string $name,
        private readonly float $price,
        private readonly string $sku,
        private readonly ?string $description = null,
    ) {}
}
```

### Nullsafe Operator

```php
declare(strict_types=1);

// Before
$country = null;
if ($user !== null && $user->getAddress() !== null) {
    $country = $user->getAddress()->getCountry();
}

// After
$country = $user?->getAddress()?->getCountry();
```

## PHP 8.5 (Upcoming, November 2025)

### Pipe Operator

```php
declare(strict_types=1);

// Pipe operator: left-to-right function composition
$result = $input
    |> trim(...)
    |> strtolower(...)
    |> fn($s) => str_replace(' ', '-', $s)
    |> urlencode(...);

// Equivalent to: urlencode(str_replace(' ', '-', strtolower(trim($input))))
```

### Clone-With

```php
declare(strict_types=1);

readonly class Config
{
    public function __construct(
        public string $host = 'localhost',
        public int $port = 3306,
        public string $database = 'app',
    ) {}
}

$config = new Config();
$testConfig = clone $config with {
    database: 'app_test',
    port: 3307,
};
```

### #[\NoDiscard] Attribute

```php
declare(strict_types=1);

class Collection
{
    #[\NoDiscard('The filtered collection is not used')]
    public function filter(callable $fn): self
    {
        return new self(array_filter($this->items, $fn));
    }
}

$collection->filter(fn($x) => $x > 5); // Warning: return value discarded
$filtered = $collection->filter(fn($x) => $x > 5); // OK
```

### array_first / array_last

```php
declare(strict_types=1);

$items = [10, 20, 30, 40];
$first = array_first($items); // 10
$last = array_last($items);   // 40
// Works with any array, preserves keys, O(1) complexity
```

## Core Features (All Modern PHP)

### Generators

```php
declare(strict_types=1);

// Memory-efficient iteration over large datasets
function readCsvLines(string $path): Generator
{
    $handle = fopen($path, 'r');
    while (($line = fgetcsv($handle)) !== false) {
        yield $line; // Yields one row at a time
    }
    fclose($handle);
}

// Process millions of rows without loading all into memory
foreach (readCsvLines('/data/huge.csv') as $row) {
    processRow($row);
}

// Generator delegation with yield from
function allUsers(): Generator
{
    yield from activeUsers();
    yield from inactiveUsers();
}
```

### Arrow Functions

```php
declare(strict_types=1);

// Arrow functions: single expression, auto-captures outer scope
$multiplier = 3;
$result = array_map(fn(int $n): int => $n * $multiplier, [1, 2, 3]);
// [3, 6, 9]

// Multi-line still requires traditional closure
$process = function (array $items) use ($config): array {
    $filtered = array_filter($items, fn($i) => $i->isValid());
    return array_map(fn($i) => $i->transform($config), $filtered);
};
```

### Traits

```php
declare(strict_types=1);

trait HasTimestamps
{
    public ?DateTimeImmutable $createdAt = null;
    public ?DateTimeImmutable $updatedAt = null;

    public function touch(): void
    {
        $this->updatedAt = new DateTimeImmutable();
    }

    public function initTimestamps(): void
    {
        $now = new DateTimeImmutable();
        $this->createdAt = $now;
        $this->updatedAt = $now;
    }
}

trait SoftDeletes
{
    public ?DateTimeImmutable $deletedAt = null;

    public function softDelete(): void
    {
        $this->deletedAt = new DateTimeImmutable();
    }

    public function isDeleted(): bool
    {
        return $this->deletedAt !== null;
    }

    public function restore(): void
    {
        $this->deletedAt = null;
    }
}

class Post
{
    use HasTimestamps, SoftDeletes;

    public function __construct(
        public readonly string $title,
        public readonly string $content,
    ) {
        $this->initTimestamps();
    }
}
```

### Late Static Binding

```php
declare(strict_types=1);

class Model
{
    // static refers to the calling class, not the defining class
    public static function create(array $attributes): static
    {
        $instance = new static(); // Creates instance of the child class
        $instance->fill($attributes);
        return $instance;
    }

    public static function query(): Builder
    {
        return (new static())->newQuery();
    }
}

class User extends Model {}

$user = User::create(['name' => 'Alice']); // Returns User, not Model
```

### Magic Methods

```php
declare(strict_types=1);

class DynamicConfig
{
    private array $data = [];

    public function __get(string $name): mixed
    {
        return $this->data[$name] ?? null;
    }

    public function __set(string $name, mixed $value): void
    {
        $this->data[$name] = $value;
    }

    public function __isset(string $name): bool
    {
        return isset($this->data[$name]);
    }

    public function __unset(string $name): void
    {
        unset($this->data[$name]);
    }

    // String representation
    public function __toString(): string
    {
        return json_encode($this->data);
    }

    // Serialize control
    public function __serialize(): array
    {
        return $this->data;
    }

    public function __unserialize(array $data): void
    {
        $this->data = $data;
    }
}
```

### SPL Data Structures

```php
declare(strict_types=1);

// SplStack (LIFO)
$stack = new SplStack();
$stack->push('first');
$stack->push('second');
echo $stack->pop(); // "second"

// SplQueue (FIFO)
$queue = new SplQueue();
$queue->enqueue('first');
$queue->enqueue('second');
echo $queue->dequeue(); // "first"

// SplPriorityQueue
$pq = new SplPriorityQueue();
$pq->insert('low', 1);
$pq->insert('high', 10);
$pq->insert('medium', 5);
echo $pq->extract(); // "high" (highest priority first)

// SplFixedArray: memory-efficient fixed-size array
$arr = new SplFixedArray(1000000);
$arr[0] = 'value'; // ~60% less memory than regular array for large datasets
```
