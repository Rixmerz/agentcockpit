---
paths: ["**/*.tsx", "**/*.jsx", "**/components/**", "**/pages/**", "**/app/**"]
---

# UI / Frontend Rules

> Always apply these rules when writing or reviewing frontend UI components.

## DO
- Use semantic HTML elements (`<nav>`, `<main>`, `<article>`, `<dialog>`, `<button>`) before reaching for ARIA roles
- Implement error boundaries at route and feature boundaries with retry capability
- Lazy load routes and heavy components with `React.lazy()` + `<Suspense>`
- Use CSS custom properties for theming and design tokens instead of hardcoded values
- Test user interactions and outcomes, not implementation details (use Testing Library queries: `getByRole`, `getByLabelText`)
- Use a stable, unique `key` prop for dynamic lists (database ID, slug, or composite key)
- Memoize expensive computations with `useMemo` (or let React Compiler handle it in React 19)
- Use Server Components by default in Next.js App Router; add `"use client"` only when needed
- Prefer controlled components for form inputs that need validation, conditional logic, or cross-field dependencies
- Use CSS logical properties (`margin-inline-start`, `padding-block`) for internationalization and RTL support
- Set explicit `width` and `height` (or `aspect-ratio`) on images and media to prevent CLS
- Co-locate component styles, tests, and types in the same directory or feature folder
- Use `AbortController` to cancel in-flight requests when components unmount or dependencies change
- Provide visible focus indicators for all interactive elements (never `outline: none` without a replacement)
- Use discriminated unions or state machines for complex UI states instead of multiple boolean flags
- Debounce user input handlers (search, resize, scroll) to avoid unnecessary work

## DON'T
- Don't use array `index` as `key` for lists that can be reordered, filtered, or have items added/removed
- Don't put business logic (API calls, data transformations, validation) directly in components -- extract to services or hooks
- Don't use `dangerouslySetInnerHTML` without sanitizing with DOMPurify or equivalent
- Don't ignore Cumulative Layout Shift -- always reserve space for async content, images, and ads
- Don't use inline styles for theming or repeated visual patterns -- use CSS classes, custom properties, or a styling system
- Don't create god components exceeding 300 lines -- split into container (data) and presentational (UI) components
- Don't fetch data in `useEffect` when TanStack Query, SWR, or Server Components are available -- they handle caching, deduplication, and error/loading states
- Don't suppress TypeScript errors with `any` in component props -- use `unknown`, generics, or proper discriminated union types
- Don't nest ternaries more than one level deep in JSX -- extract to early returns, variables, or sub-components
- Don't store derived state in `useState` -- compute it inline or with `useMemo` from the source state
- Don't use `useEffect` to sync state that can be computed during render (this is the most common React anti-pattern)
- Don't hardcode strings in the UI if the app may need internationalization -- extract to a translation system early
- Don't skip the `alt` attribute on `<img>` tags -- use `alt=""` for decorative images, descriptive text for informational ones
- Don't create wrapper `<div>` elements solely for styling -- use CSS Grid/Flexbox on the semantic parent, or use `<Fragment>`
