---
paths: ["**/Dockerfile*", "**/docker-compose*", "**/k8s/**", "**/kubernetes/**", "**/helm/**", "**/charts/**", "**/*.tf", "**/*.tfvars", "**/ansible/**", "**/*.yml.j2", "**/argocd/**"]
---

# DevOps # DevOps & Infrastructure Rules Infrastructure Rules

> Always apply these rules when working with containers, Kubernetes, Terraform, or deployment infrastructure.

## DO
- Use multi-stage Docker builds for minimal production images
- Run containers as non-root user (USER directive)
- Use distroless or alpine base images in production
- Always define resource requests and limits in K8s manifests
- Configure liveness, readiness, and startup probes for every deployment
- Use PodDisruptionBudget for high-availability workloads (replicas > 1)
- Set security context (runAsNonRoot, readOnlyRootFilesystem, drop ALL capabilities)
- Use NetworkPolicy for pod-to-pod traffic control (default deny + explicit allow)
- Store secrets in external secret managers (Vault, cloud SM), not in manifests or Dockerfiles
- Use Terraform remote state with locking (S3+DynamoDB, Terraform Cloud, or equivalent)
- Pin versions in Dockerfiles, Helm charts, Terraform modules, and CI action references
- Use `set -euo pipefail` in all bash scripts
- Implement graceful shutdown (preStop hook + terminationGracePeriodSeconds)
- Use GitOps (ArgoCD/Flux) for K8s deployments — don't `kubectl apply` from CI
- Tag all cloud resources with Environment, ManagedBy, and Repository
- Use Infracost/checkov/tfsec to validate IaC in CI before apply
- Use COPY (not ADD) in Dockerfiles
- Include HEALTHCHECK in Dockerfiles
- Use `.dockerignore` to exclude .git, node_modules, tests, and docs

## DON'T
- Don't use `latest` tag in production Dockerfiles or K8s manifests
- Don't run containers as root
- Don't use ADD in Dockerfiles — use COPY (ADD has implicit URL fetch and tar extraction)
- Don't put secrets in Dockerfiles, env vars in manifests, or Terraform code
- Don't use `kubectl apply` directly in production without dry-run/diff
- Don't use `terraform apply -auto-approve` in production
- Don't hardcode AWS/GCP/Azure credentials — use IAM roles or workload identity
- Don't deploy without health checks (liveness + readiness probes)
- Don't run K8s pods without resource requests
- Don't expose admin dashboards (Grafana, ArgoCD, K8s Dashboard) without authentication
- Don't use `sleep` in scripts for health checks — use proper polling with timeout
- Don't store Terraform state locally — use remote backend with locking
- Don't create K8s resources in the default namespace
- Don't ignore Trivy/Snyk vulnerability scan results in CI
- Don't use `sleep` as a preStop hook substitute — use it alongside proper drain logic
- Don't commit `.tfvars` with sensitive values — use environment variables or Vault
