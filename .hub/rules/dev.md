---
paths: ["**/docker-compose*", "**/Dockerfile*", "**/.github/**", "**/.gitlab-ci*", "**/terraform/**", "**/k8s/**", "**/helm/**", "**/infrastructure/**", "**/deploy/**", "**/ci/**"]
---

# Development # Development & Infrastructure Rules Infrastructure Rules

> Always apply these rules when working with CI/CD, Docker, or infrastructure configuration.

## DO
- Use multi-stage Docker builds for minimal production images
- Run containers as non-root user (`USER app` or `USER 1000`)
- Use versioned database migrations (never manual schema changes)
- Version APIs explicitly (`/api/v1/`, `/api/v2/`)
- Use structured JSON logging with correlation IDs in all services
- Implement health checks (`/health/live` and `/health/ready`)
- Use IaC (Terraform/CDK/Pulumi) for all infrastructure -- no manual provisioning
- Use secrets management (Vault, cloud secret stores) -- never hardcode secrets
- Implement graceful shutdown handling (SIGTERM: drain connections, finish in-flight requests)
- Use connection pooling for all database connections
- Pin dependency versions in CI/CD and Dockerfiles (never `latest` in production)
- Use Conventional Commits for semantic versioning (`feat:`, `fix:`, `chore:`)
- Implement rate limiting on all public-facing endpoints
- Use idempotency keys for critical write operations (payments, orders)
- Include `.dockerignore` to exclude `.git`, `node_modules`, test files from images
- Use `HEALTHCHECK` instruction in Dockerfiles
- Set resource limits (CPU, memory) on all container deployments
- Use read replicas for read-heavy database workloads

## DON'T
- Don't run containers as root
- Don't use `latest` tag in production Dockerfiles -- pin exact versions
- Don't hardcode secrets, API keys, or credentials in code or CI config
- Don't expose stack traces or internal errors in production API responses
- Don't use `SELECT *` in production queries -- select only needed columns
- Don't put business logic in stored procedures (hard to test, version, review)
- Don't use `CORS: *` for APIs handling sensitive data -- specify exact origins
- Don't create JWT tokens without expiration (`exp` claim is mandatory)
- Don't ignore dependency vulnerability alerts (Snyk, Dependabot, `npm audit`)
- Don't use manual deployments -- automate everything with CI/CD pipelines
- Don't alert on individual exceptions -- alert on SLO burn rate violations
- Don't use high-cardinality labels in metrics (no `user_id` in Prometheus labels)
- Don't use `ADD` in Dockerfiles when `COPY` suffices (ADD auto-extracts archives)
- Don't store state in containers -- they are ephemeral
- Don't skip rollback plans for database migrations
