# Contributing to AgentCockpit

Thank you for your interest in contributing to AgentCockpit! This document provides guidelines and instructions for contributing.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Bug Reports](#bug-reports)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

---

## Getting Started

### Prerequisites
- Node.js 18+
- Rust (latest stable)
- Git
- Familiarity with React, TypeScript, and Tauri

### Setup
```bash
# Fork and clone the repository
git clone https://github.com/yourusername/agentcockpit.git
cd agentcockpit

# Install dependencies
npm install

# Run in development
npm run tauri dev
```

---

## Development Workflow

### Branch Strategy
- `master` - stable releases
- `develop` - development branch (if applicable)
- `feature/*` - new features
- `fix/*` - bug fixes
- `docs/*` - documentation updates

### Making Changes
1. Create a new branch from `master`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following our [coding standards](#coding-standards)

3. Test your changes thoroughly

4. Commit following our [commit guidelines](#commit-guidelines)

5. Push and create a Pull Request

---

## Coding Standards

### TypeScript/React
- Use **functional components** with hooks
- Prefer **TypeScript** types over `any`
- Use **const** for constants, **let** for variables
- Follow existing code formatting (check `.eslintrc`)
- Add JSDoc comments for public APIs

### File Organization
```typescript
// 1. Imports (external first, then internal)
import { useState } from 'react';
import { MyComponent } from '../components';

// 2. Types/Interfaces
interface Props {
  title: string;
}

// 3. Component
export function MyComponent({ title }: Props) {
  // hooks first
  const [state, setState] = useState();

  // callbacks
  const handleClick = () => {};

  // render
  return <div>{title}</div>;
}
```

### Naming Conventions
- **Components**: PascalCase (`TerminalView.tsx`)
- **Hooks**: camelCase with `use` prefix (`useTerminalActivity.ts`)
- **Services**: camelCase (`soundService.ts`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_TERMINALS`)
- **Types/Interfaces**: PascalCase (`ProjectConfig`)

### Styling
- Use existing CSS variables (see `App.css`)
- Follow glass-morphism design patterns
- Ensure dark mode compatibility
- Test responsive behavior

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Build process or auxiliary tool changes

### Examples
```
feat(notifications): add custom sound selector

Implemented dropdown to select from 6 predefined notification sounds
with preview functionality.

Closes #123
```

```
fix(terminal): resolve infinite loop in activity tracking

Fixed useCallback memoization issue causing render loops.
```

---

## Pull Request Process

### Before Submitting
1. ✅ Code builds without errors (`npm run build`)
2. ✅ All tests pass (if applicable)
3. ✅ Code follows style guidelines
4. ✅ Commit messages follow conventions
5. ✅ Documentation updated (if needed)
6. ✅ CHANGELOG.md updated for notable changes

### PR Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe how you tested your changes

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code builds successfully
- [ ] Self-reviewed code
- [ ] Commented complex code
- [ ] Updated documentation
- [ ] No new warnings
```

### Review Process
1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, PR will be merged
4. Your contribution will be credited in CHANGELOG

---

## Bug Reports

### Before Reporting
- Check [existing issues](https://github.com/yourusername/agentcockpit/issues)
- Try reproducing on latest version
- Gather system information

### Bug Report Template
```markdown
**Describe the bug**
Clear description of the bug

**To Reproduce**
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What should happen

**Screenshots**
If applicable

**Environment:**
- OS: [e.g. macOS 13.5]
- AgentCockpit Version: [e.g. 1.0.0]
- Node Version: [e.g. 18.0.0]

**Additional context**
Any other relevant information
```

---

## Feature Requests

We welcome feature ideas! Please:

1. Check if feature already requested
2. Describe the problem it solves
3. Propose a solution
4. Consider alternatives

### Template
```markdown
**Problem**
What problem does this solve?

**Proposed Solution**
How should it work?

**Alternatives**
Other ways to solve this?

**Additional Context**
Screenshots, mockups, etc.
```

---

## Project Structure

```
src/
├── components/          # React components
│   ├── common/          # Reusable components
│   ├── sidebar-left/    # Left sidebar components
│   ├── sidebar-right/   # Right sidebar components
│   ├── settings/        # Settings modal
│   └── terminal/        # Terminal-related components
├── contexts/            # React contexts (state management)
├── hooks/               # Custom React hooks
├── services/            # Business logic and external APIs
├── agents/              # Plugin integrations
├── core/                # Core utilities
└── types/               # TypeScript type definitions
```

---

## Questions?

- **Discussions**: [GitHub Discussions](https://github.com/yourusername/agentcockpit/discussions)
- **Issues**: [GitHub Issues](https://github.com/yourusername/agentcockpit/issues)

---

Thank you for contributing to AgentCockpit! 🚀
