# PHP Architecture Patterns

## Laravel Clean Architecture / DDD Structure

```
app/
├── Domain/                          # Pure business logic, no framework deps
│   ├── Order/
│   │   ├── Models/
│   │   │   ├── Order.php            # Eloquent model (or plain entity)
│   │   │   └── OrderLine.php
│   │   ├── Enums/
│   │   │   └── OrderStatus.php
│   │   ├── ValueObjects/
│   │   │   └── Money.php
│   │   ├── Events/
│   │   │   └── OrderPlaced.php
│   │   ├── Exceptions/
│   │   │   └── InsufficientStockException.php
│   │   └── Repositories/
│   │       └── OrderRepository.php  # Interface only
│   └── User/
│       └── ...
├── Application/                     # Use cases, orchestration
│   ├── Order/
│   │   ├── Commands/
│   │   │   ├── PlaceOrderCommand.php
│   │   │   └── PlaceOrderHandler.php
│   │   ├── Queries/
│   │   │   ├── GetOrderQuery.php
│   │   │   └── GetOrderHandler.php
│   │   └── DTOs/
│   │       └── CreateOrderDTO.php
│   └── User/
│       └── ...
└── Infrastructure/                  # Framework bindings, external services
    ├── Persistence/
    │   └── EloquentOrderRepository.php  # Implements OrderRepository
    ├── Mail/
    │   └── OrderConfirmationMail.php
    └── Providers/
        └── DomainServiceProvider.php    # Binds interfaces to implementations
```

### Service Provider Binding

```php
declare(strict_types=1);

class DomainServiceProvider extends ServiceProvider
{
    public array $bindings = [
        OrderRepository::class => EloquentOrderRepository::class,
        UserRepository::class => EloquentUserRepository::class,
        PaymentGateway::class => StripePaymentGateway::class,
    ];
}
```

### Command Handler (Application Layer)

```php
declare(strict_types=1);

readonly class PlaceOrderCommand
{
    public function __construct(
        public int $userId,
        public array $items,
        public ShippingMethod $shipping,
    ) {}
}

class PlaceOrderHandler
{
    public function __construct(
        private readonly OrderRepository $orders,
        private readonly InventoryService $inventory,
        private readonly PaymentGateway $payment,
    ) {}

    public function handle(PlaceOrderCommand $command): Order
    {
        // Verify stock
        foreach ($command->items as $item) {
            $this->inventory->reserve($item['product_id'], $item['quantity']);
        }

        // Create order
        $order = Order::create([
            'user_id' => $command->userId,
            'shipping_method' => $command->shipping,
            'status' => OrderStatus::Pending,
        ]);

        // Process payment
        $this->payment->charge($order->total(), $command->userId);

        // Dispatch domain event
        OrderPlaced::dispatch($order);

        return $order;
    }
}
```

## Hexagonal Architecture with Symfony

```
src/
├── Domain/                      # Core business logic
│   ├── Model/
│   │   ├── Product.php          # Entity (plain PHP, no ORM annotations)
│   │   └── ProductId.php        # Value object
│   ├── Port/                    # Interfaces (ports)
│   │   ├── In/                  # Driving ports (use cases)
│   │   │   └── CreateProductUseCase.php
│   │   └── Out/                 # Driven ports (secondary)
│   │       ├── ProductRepository.php
│   │       └── EventPublisher.php
│   └── Service/
│       └── ProductService.php   # Implements driving port
├── Application/                 # Adapters for driving side
│   ├── Controller/
│   │   └── ProductController.php
│   └── Command/
│       └── ImportProductsCommand.php
└── Infrastructure/              # Adapters for driven side
    ├── Persistence/
    │   └── DoctrineProductRepository.php
    ├── Messaging/
    │   └── SymfonyEventPublisher.php
    └── config/
        └── services.yaml
```

### Port (Interface)

```php
declare(strict_types=1);

namespace App\Domain\Port\Out;

interface ProductRepository
{
    public function findById(ProductId $id): ?Product;
    public function save(Product $product): void;
    public function nextIdentity(): ProductId;
}
```

### Adapter (Implementation)

```php
declare(strict_types=1);

namespace App\Infrastructure\Persistence;

class DoctrineProductRepository implements ProductRepository
{
    public function __construct(
        private readonly EntityManagerInterface $em,
    ) {}

    public function findById(ProductId $id): ?Product
    {
        return $this->em->find(Product::class, $id->value);
    }

    public function save(Product $product): void
    {
        $this->em->persist($product);
        $this->em->flush();
    }

    public function nextIdentity(): ProductId
    {
        return new ProductId(Uuid::uuid4()->toString());
    }
}
```

## Magento 2 Module Architecture

```
app/code/Vendor/Module/
├── etc/
│   ├── module.xml               # Module declaration and dependencies
│   ├── di.xml                   # Dependency injection configuration
│   ├── frontend/
│   │   └── routes.xml           # Frontend routing
│   └── webapi.xml               # REST/SOAP API declaration
├── Api/
│   ├── ProductRepositoryInterface.php  # Service contract
│   └── Data/
│       └── ProductInterface.php        # Data interface
├── Model/
│   ├── Product.php              # Model implementation
│   └── ResourceModel/
│       └── Product.php          # Resource model (DB layer)
├── Plugin/                      # Interceptors
│   └── ProductPlugin.php
├── Observer/                    # Event observers
│   └── ProductSaveObserver.php
├── Block/                       # View models
├── Controller/                  # Action controllers
├── view/
│   ├── frontend/
│   │   ├── layout/              # XML layout instructions
│   │   └── templates/           # PHTML templates
│   └── adminhtml/
└── Setup/
    └── Patch/
        └── Data/                # Data patches (migrations)
```

### di.xml Plugin Interceptors

```xml
<!-- etc/di.xml -->
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="urn:magento:framework:ObjectManager/etc/config.xsd">

    <!-- Preference: interface to implementation binding -->
    <preference for="Vendor\Module\Api\ProductRepositoryInterface"
                type="Vendor\Module\Model\ProductRepository" />

    <!-- Plugin: intercept method calls (before/after/around) -->
    <type name="Magento\Catalog\Model\Product">
        <plugin name="vendor_module_product_plugin"
                type="Vendor\Module\Plugin\ProductPlugin"
                sortOrder="10" />
    </type>
</config>
```

### Plugin (Interceptor) — Before/After/Around

```php
declare(strict_types=1);

class ProductPlugin
{
    // Runs BEFORE Product::setPrice()
    public function beforeSetPrice(Product $subject, float $price): array
    {
        // Modify arguments before the original method
        $adjustedPrice = max($price, 0.01); // Enforce minimum price
        return [$adjustedPrice]; // Return modified arguments as array
    }

    // Runs AFTER Product::getName()
    public function afterGetName(Product $subject, string $result): string
    {
        // Modify the return value
        return trim($result);
    }

    // Wraps AROUND Product::save()
    public function aroundSave(Product $subject, callable $proceed): Product
    {
        // Code before
        $this->logger->info('Saving product: ' . $subject->getSku());
        $result = $proceed(); // Call original method
        // Code after
        $this->cache->invalidate($subject->getId());
        return $result;
    }
}
```

## Vertical Slice Architecture

```
src/
├── Features/
│   ├── CreateOrder/
│   │   ├── CreateOrderController.php
│   │   ├── CreateOrderRequest.php     # Form request / validation
│   │   ├── CreateOrderHandler.php     # Business logic
│   │   ├── CreateOrderResponse.php    # Response DTO
│   │   └── CreateOrderTest.php        # Tests for this feature
│   ├── GetOrder/
│   │   ├── GetOrderController.php
│   │   ├── GetOrderHandler.php
│   │   └── GetOrderTest.php
│   └── CancelOrder/
│       ├── CancelOrderController.php
│       ├── CancelOrderHandler.php
│       └── CancelOrderTest.php
└── Shared/                            # Cross-cutting concerns only
    ├── Models/
    │   └── Order.php
    ├── Middleware/
    └── Exceptions/
```

Each feature is self-contained: controller, handler, request, response, and tests in one directory. No horizontal layers that span the entire app.

## WordPress Architecture

### Hooks: Actions & Filters

```php
declare(strict_types=1);

// ACTION: do something at a specific point (no return value)
add_action('init', function (): void {
    register_post_type('product', [
        'label' => 'Products',
        'public' => true,
        'supports' => ['title', 'editor', 'thumbnail'],
        'has_archive' => true,
        'show_in_rest' => true, // Enable Gutenberg + REST API
    ]);
});

// FILTER: modify data passing through (must return value)
add_filter('the_content', function (string $content): string {
    if (is_single() && get_post_type() === 'product') {
        $price = get_post_meta(get_the_ID(), '_price', true);
        $content .= '<p class="product-price">Price: $' . esc_html($price) . '</p>';
    }
    return $content;
});

// WordPress REST API: custom endpoint
add_action('rest_api_init', function (): void {
    register_rest_route('myapp/v1', '/products', [
        'methods' => 'GET',
        'callback' => function (WP_REST_Request $request): WP_REST_Response {
            $posts = get_posts([
                'post_type' => 'product',
                'posts_per_page' => $request->get_param('per_page') ?? 10,
            ]);
            return new WP_REST_Response($posts, 200);
        },
        'permission_callback' => '__return_true',
    ]);
});

// Gutenberg block registration (PHP side)
add_action('init', function (): void {
    register_block_type(__DIR__ . '/build/blocks/hero');
});
```

## PSR Standards Reference

| PSR | Name | Purpose |
|-----|------|---------|
| PSR-1 | Basic Coding Standard | File formatting, naming conventions, side effects |
| PSR-4 | Autoloading Standard | Maps namespace prefixes to directory paths (Composer) |
| PSR-7 | HTTP Message Interface | Immutable Request/Response/Uri/Stream interfaces |
| PSR-11 | Container Interface | `ContainerInterface` with `get()` and `has()` |
| PSR-12 | Extended Coding Style | Code style rules (extends PSR-1), superseded by PER |
| PSR-15 | HTTP Server Handlers | `RequestHandlerInterface` and `MiddlewareInterface` |
| PSR-17 | HTTP Factories | Factory interfaces for PSR-7 objects |
| PSR-18 | HTTP Client | `ClientInterface` with `sendRequest()` |
| PSR-3 | Logger Interface | `LoggerInterface` with 8 severity levels |
| PSR-6/16 | Caching Interface | `CacheItemPoolInterface` (PSR-6) / `SimpleCacheInterface` (PSR-16) |

### PSR-4 Autoloading (composer.json)

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "src/",
            "App\\Tests\\": "tests/"
        }
    }
}
```

Maps `App\Domain\Order\Models\Order` to `src/Domain/Order/Models/Order.php`.
