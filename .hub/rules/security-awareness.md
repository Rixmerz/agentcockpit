# Security Awareness

> Always apply these security checks when writing or reviewing code.

Rules for proactive security during development.

## Before Modifying High-Risk Files
- Check `cube_get_file_risk(path)` before modifying files with high centrality (many dependents)
- If the file has open security findings, read them first with `cube_get_findings(file_path=...)`
- Use `cube_security_remediation(finding_id)` to get context before fixing security issues
- Never suppress findings without documenting a reason

## When Writing New Code
- Validate all external input at system boundaries (user input, API responses, file reads)
- Use parameterized queries — never concatenate user input into SQL/commands
- Avoid `eval()`, `exec()`, `os.system()`, `shell=True` — use safe alternatives
- Sanitize HTML output to prevent XSS — use framework-provided escaping
- Store secrets in environment variables, never in code or config files
- Use constant-time comparison for authentication tokens
- Set appropriate CORS, CSP, and security headers

## After Security Scan
- Review `cube_finding_stats()` output to understand the project's security posture
- Prioritize critical and high severity findings over features
- Use `cube_blast_radius(path)` to understand exploit impact before fixing
- Fix root causes, not symptoms — a finding often indicates a pattern to fix project-wide

## In Code Review
- Flag any new usage of dangerous patterns: raw SQL, shell commands, innerHTML, eval
- Verify authentication and authorization on all new endpoints
- Check for hardcoded credentials, API keys, or tokens in new code
