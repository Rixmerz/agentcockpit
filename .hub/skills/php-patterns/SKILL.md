---
name: php-patterns
description: PHP 8.x architecture reference - frameworks, design patterns, Laravel/Symfony, WordPress, and production best practices for 2024-2025. Use when making architectural decisions, reviewing PHP code, or selecting packages.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# PHP Patterns & Architecture Skill

## Quick Navigation

- [Frameworks & Libraries](./frameworks.md) — Laravel, Symfony, WordPress, ORMs, testing, async runtimes
- [Design Patterns](./design-patterns.md) — Builder, Factory, Repository, Strategy, Value Object, DTO, Result
- [Architecture](./architecture.md) — Clean Architecture, Hexagonal, DDD, Vertical Slice, PSR standards
- [Best Practices](./best-practices.md) — Type safety, security, error handling, CI tooling
- [Language Features](./language-features.md) — PHP 8.0-8.5 features with code examples

## Decision Framework

| Need | Recommendation |
|------|---------------|
| Web API (REST/GraphQL) | Laravel 12 + API Resources, or API Platform 4.2 (Symfony) |
| CMS / Content site | WordPress 6.8 (simple), Statamic 5 (Laravel-based), Drupal 11 (enterprise) |
| E-commerce | WooCommerce (WordPress), Magento 2 / Adobe Commerce, Sylius (Symfony) |
| CLI tool | Symfony Console, Laravel Zero, or Minicli |
| Enterprise / DDD | Symfony 7.4 + Doctrine + Messenger |
| High-performance / Async | FrankenPHP 1.8 + Laravel Octane, or Swoole / RoadRunner |
| Microservice | Slim 4, Mezzio (Laminas), or Symfony micro-kernel |

## Recommended Stacks 2025

| Use Case | Stack |
|----------|-------|
| API development | Laravel 12 + Sanctum + Eloquent + Pest 3 + PHPStan |
| Enterprise platform | Symfony 7.4 + Doctrine + Messenger + PHPUnit 11 + Psalm |
| CMS / Marketing | WordPress 6.8 + ACF Pro + Gutenberg + WP-CLI |
| E-commerce | Magento 2.4 / Sylius 2.0 + Stripe SDK + Redis |
| CLI tooling | Laravel Zero / Symfony Console + PHP-CS-Fixer |
| High-performance | FrankenPHP + Laravel Octane + Swoole + Redis |

## PHP Version Reference

| Version | Release | Status | Key Features |
|---------|---------|--------|-------------|
| 8.1 | Nov 2021 | Security fixes until Dec 2025 | Enums, Fibers, intersection types, readonly properties, `never` type |
| 8.2 | Dec 2022 | Active support | Readonly classes, DNF types, `null`/`false`/`true` standalone types |
| 8.3 | Nov 2023 | Active support | Typed class constants, `json_validate()`, `#[\Override]`, dynamic class const fetch |
| 8.4 | Nov 2024 | Active support | Property hooks, asymmetric visibility, lazy objects, `array_find()`, `#[\Deprecated]` |
| 8.5 | Nov 2025 | Upcoming | Pipe operator (`\|>`), `clone-with`, `#[\NoDiscard]`, `array_first()`/`array_last()` |

## Production Users

| Company/Product | Scale | PHP Usage |
|----------------|-------|-----------|
| WordPress | 43% of all websites | Core CMS engine |
| Slack | 42M+ daily active users | Backend services |
| Etsy | $13.2B GMV | Primary backend |
| Wikipedia (MediaWiki) | Top 10 global site | Core platform |
| Tumblr | 500M+ blogs | Backend infrastructure |
| Facebook / Meta | 3B+ users | Hack (PHP derivative), HHVM origin |
| Mailchimp | 13M+ users | Backend services |
| Shopify (Liquid) | $236B GMV | Admin tooling |

> **Minimum recommended version:** PHP 8.2 for new projects (readonly classes, DNF types). PHP 8.4 preferred for property hooks and lazy objects.

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
