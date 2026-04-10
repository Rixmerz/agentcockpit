---
paths: ["**/*.figma", "**/*.sketch", "**/design/**", "**/ux/**", "**/accessibility/**", "**/*.css", "**/*.scss"]
---

# UX / Design Rules

> Always apply these rules when making UX, accessibility, or design decisions.

## DO
- Follow WCAG 2.2 AA as the minimum accessibility standard for all interactive elements -- test against all 9 new criteria added in WCAG 2.2
- Use semantic HTML elements (`<nav>`, `<main>`, `<button>`, `<dialog>`, `<form>`) before reaching for ARIA roles -- the first rule of ARIA is "don't use ARIA" if a native element works
- Ensure all interactive targets are at least 24x24 CSS pixels (WCAG 2.5.8 Target Size Minimum) -- use padding to increase hit area without changing visual size
- Provide a single-pointer alternative (click, tap, or keyboard) for every drag interaction (WCAG 2.5.7 Dragging Movements)
- Maintain consistent help placement (contact, chat, FAQ links) in the same relative position across all pages (WCAG 3.2.6)
- Implement visible focus indicators that are never fully obscured by sticky headers, floating toolbars, or cookie banners (WCAG 2.4.11) -- use `scroll-padding-top` to account for fixed elements
- Use design tokens (CSS custom properties, Tailwind theme values, or design system variables) for all colors, spacing, typography, and motion values instead of hardcoded values
- Test usability with at least 5 representative users per round -- this finds approximately 85% of usability problems at minimal cost
- Measure and optimize Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1 -- these directly affect user experience and SEO ranking
- Write descriptive error messages that state what happened, why, and how the user can recover -- "That email is already registered. Try signing in or use a different email" not "Error 422"
- Respect `prefers-reduced-motion` by disabling or reducing animations -- use `@media (prefers-reduced-motion: reduce)` to provide alternative transitions or no animation
- Provide text alternatives for all non-text content -- use descriptive `alt` text for informational images and `alt=""` for decorative ones
- Use progressive disclosure for complex forms and settings -- show only essential fields initially, reveal advanced options on demand
- Document accessibility requirements for each component in the design system -- include keyboard behavior, ARIA attributes, screen reader announcements, and contrast requirements
- Implement skip navigation links as the first focusable element on every page -- allows keyboard users to bypass repeated navigation blocks
- Maintain a minimum color contrast ratio of 4.5:1 for normal text (< 18pt) and 3:1 for large text (>= 18pt / 14pt bold) per WCAG 1.4.3

## DON'T
- Don't use color alone to convey information (error states, status indicators, required fields) -- always pair with text, icons, or patterns (WCAG 1.4.1)
- Don't implement dark patterns: no confirmshaming, hidden costs, forced continuity, misdirection, or roach motel flows -- these violate EU DSA (fines up to 6% revenue) and damage user trust
- Don't require cognitive function tests (memorizing passwords, solving puzzles, transcribing CAPTCHAs) as the only authentication method (WCAG 3.3.8) -- support password managers, passkeys, or WebAuthn
- Don't auto-play media with sound -- if media must auto-play, start muted with visible controls to unmute (WCAG 1.4.2)
- Don't remove focus outlines (`outline: none`) without providing an equally visible replacement focus indicator -- invisible focus traps keyboard users
- Don't use carousels or auto-advancing slideshows as the primary display for important content -- most users see only the first slide; use static layouts or user-initiated navigation
- Don't rely solely on placeholder text as form field labels -- placeholders disappear on input, leaving users without context; use persistent visible labels
- Don't trap keyboard focus inside modals or dialogs without providing an escape mechanism (Escape key, explicit close button) -- focus must be manageable and predictable
- Don't use CAPTCHA without providing an accessible alternative (audio CAPTCHA, logic puzzle, or server-side bot detection) -- standard visual CAPTCHAs exclude users with visual or cognitive disabilities
- Don't ignore right-to-left (RTL) layout requirements when designing for international audiences -- use CSS logical properties (`margin-inline-start`, `padding-block-end`) and test with RTL languages
- Don't use infinite scroll as the only content navigation method -- provide pagination, "load more" buttons, or position indicators so users can bookmark, share, and return to specific positions
- Don't disable browser zoom or text scaling (`user-scalable=no`, `maximum-scale=1`) -- users with low vision depend on zoom functionality (WCAG 1.4.4)
- Don't require users to re-enter information they already provided in a previous step of the same flow (WCAG 3.3.7 Redundant Entry) -- auto-populate or offer selection from previously entered data
- Don't assume mouse-only interaction -- every feature must be operable via keyboard, touch, and assistive technology; test all flows without a pointing device
