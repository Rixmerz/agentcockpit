# Product Structure Guide

AgentCockpit uses a hierarchical product structure to organize features by domain.

## Structure

```
.claude/product/
├── index.md              # Product overview (name, description, tech stack)
├── README.md             # This file - documentation about the structure
└── domains/              # Business domains (create as needed)
    ├── authentication/
    │   ├── index.md      # Domain overview
    │   └── features/
    │       ├── login.md
    │       └── register.md
    └── user-management/
        ├── index.md
        └── features/
            └── profile.md
```

## Files Explained

### `index.md` (Product Level)
- Product name and description
- Tech stack
- High-level goals
- List of domains
- Architecture notes
- Success criteria

### `domains/{domain-name}/index.md` (Domain Level)
- Domain description and purpose
- List of features in this domain
- Domain-specific constraints
- Dependencies on other domains

### `domains/{domain-name}/features/{feature-name}.md` (Feature Level)
- Feature description
- Priority (CRITICAL, HIGH, MEDIUM, LOW)
- Acceptance criteria (checkboxes)
- User stories
- Technical notes
- Subtasks breakdown

## When to Create a Domain

Create a new domain when you have:
- A distinct business area (e.g., authentication, billing, analytics)
- Multiple related features (e.g., login, register, password reset)
- Shared logic or data models
- Clear boundaries from other domains

**Example domains:**
- `authentication` - Login, registration, password reset
- `user-management` - Profile, settings, preferences
- `purchasing` - Cart, checkout, orders, payments
- `analytics` - Dashboards, reports, metrics
- `content` - Posts, comments, media uploads

## Example Feature File

```markdown
<!-- .claude/product/domains/authentication/features/login.md -->

# Feature: User Login

**Priority**: CRITICAL

**Description**: Allow existing users to authenticate with email and password.

## Acceptance Criteria

- [ ] Login form with email and password fields
- [ ] Client-side validation before submission
- [ ] API endpoint POST /api/auth/login
- [ ] Returns JWT token on success
- [ ] Sets httpOnly cookie with token
- [ ] Returns 401 for invalid credentials
- [ ] Rate limited to 10 requests per minute
- [ ] Account lockout after 5 failed attempts

## User Stories

- As a returning user, I want to log in with my credentials so that I can access my account

## Subtasks

### 1. Create login form UI
**Status**: pending

- [ ] Email and password input fields
- [ ] "Remember me" checkbox
- [ ] "Forgot password" link
- [ ] Loading state during authentication
- [ ] Error message display

### 2. Implement login API endpoint
**Status**: pending

- [ ] Verify email exists in database
- [ ] Compare hashed password using bcrypt
- [ ] Generate JWT token with 7-day expiration
- [ ] Set secure httpOnly cookie
- [ ] Implement rate limiting
- [ ] Track failed login attempts

## Technical Notes

- Use jose or jsonwebtoken for JWT
- Store failed attempts in Redis
- Set cookie flags: httpOnly, secure, sameSite=strict
```

## Priority Levels

- **CRITICAL** - Must have for MVP, blocks other features
- **HIGH** - Important for MVP, should include
- **MEDIUM** - Nice to have if time permits
- **LOW** - Future enhancement, not for MVP

## Status Tracking

- `pending` - Not started
- `in-progress` - Currently being worked on
- `complete` - Done and tested
- `blocked` - Waiting for decision or dependency

## Getting Started

1. Edit `index.md` to describe your product
2. Create domains under `domains/` for major functional areas
3. Add features under each domain's `features/` directory
4. Run `/AgentCockpit-start` in Claude Code to begin development

For more information, see the AgentCockpit documentation.
