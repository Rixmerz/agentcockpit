---
name: fresh-ui-animation
description: |
  Animation system skill for Deno Fresh + Preact applications with 20+ presets,
  CSS-based animations, and Web Animations API support.
  
  Use this skill when:
  - Adding animations to UI components
  - Creating page transitions
  - Building scroll-triggered animations
  - Implementing hover/press interactions
  - Creating entrance/exit animations for modals, dropdowns, toasts
  - Building staggered list animations
  - Need motion effects (fade, slide, scale, shake)
  - Creating custom animation configurations
  - Working with AnimatePresence for mount/unmount animations
  - Implementing reduced-motion accessible animations
  
  Provides Animated, AnimatePresence, StaggerContainer components and
  20+ animation presets including fade, slide, scale, modal, dropdown, etc.
---

# Fresh UI Animation Skill

Complete animation system for Deno Fresh + Preact with 20+ presets, CSS-based animations, and Web Animations API support.

## Core Components

### Animated
Wrapper component for single-element animations.

```tsx
import { Animated } from './lib/animation.tsx';

// Basic fade-in
<Animated animation="fade-up">
  <Card>Content</Card>
</Animated>

// With custom duration and delay
<Animated animation="scale-in" duration={0.5} delay={0.2}>
  <Badge>New</Badge>
</Animated>

// With trigger
<Animated animation="fade-up" trigger="in-view">
  <FeatureCard />
</Animated>

// With callbacks
<Animated 
  animation="fade-in" 
  onEnter={() => console.log('entered')}
  onExit={() => console.log('exited')}
>
  Content
</Animated>
```

**Props:**
- `animation` - Animation preset name or custom config
- `show` - Boolean to control visibility (default: true)
- `duration` - Duration in seconds (default: from preset)
- `delay` - Delay before animation starts
- `trigger` - When to trigger: `'mount' | 'hover' | 'press' | 'in-view'`
- `as` - HTML element to render (default: 'div')
- `className` - Additional CSS classes
- `onEnter` - Callback when animation enters
- `onExit` - Callback when animation exits

### AnimatePresence
For enter/exit animations when mounting/unmounting.

```tsx
import { AnimatePresence } from './lib/animation.tsx';

// Modal enter/exit
<AnimatePresence show={isOpen} animation="modal" duration={0.3}>
  <ModalContent />
</AnimatePresence>

// Dropdown animation
<AnimatePresence show={isOpen} animation="dropdown">
  <DropdownMenu />
</AnimatePresence>

// Toast slide-in
<AnimatePresence show={showToast} animation="slide-in-right">
  <Toast message="Saved!" />
</AnimatePresence>
```

**Props:**
- `show` - Boolean to control visibility
- `animation` - Animation preset
- `duration` - Duration in seconds
- `children` - Content to animate

### StaggerContainer
For staggered list animations.

```tsx
import { StaggerContainer } from './lib/animation.tsx';

// Staggered cards
<StaggerContainer animation="fade-up" staggerDelay={0.1}>
  {items.map((item, i) => (
    <Card key={item.id}>{item.name}</Card>
  ))}
</StaggerContainer>

// Staggered list items
<StaggerContainer animation="slide-in-right" staggerDelay={0.05}>
  {tasks.map(task => (
    <TaskItem key={task.id} task={task} />
  ))}
</StaggerContainer>
```

**Props:**
- `animation` - Animation preset for children
- `staggerDelay` - Delay between each child
- `children` - List of elements to animate

## Animation Presets

### Fade Animations
```tsx
// Basic fade
<Animated animation="fade-in">Content</Animated>

// Fade with direction
<Animated animation="fade-up">    // Fade + move up
<Animated animation="fade-down">  // Fade + move down
<Animated animation="fade-left">  // Fade + move left
<Animated animation="fade-right"> // Fade + move right
```

### Scale Animations
```tsx
// Scale in
<Animated animation="scale-in">Content</Animated>

// Scale up (pop effect)
<Animated animation="scale-up">

// Scale with fade
<Animated animation="fade-scale">

// Pop effect (bounce)
<Animated animation="scale-pop">  // Good for badges/notifications
```

### Slide Animations
```tsx
// Slide in from edges
<Animated animation="slide-in-left">
<Animated animation="slide-in-right">
<Animated animation="slide-in-up">
<Animated animation="slide-in-down">
```

### Component-Specific
```tsx
// Modal animations
<Animated animation="modal">     // Scale + fade for modals
<Animated animation="sheet">     // Slide for side panels

// Dropdown/Popover
<Animated animation="dropdown">  // Scale + fade for menus
<Animated animation="tooltip">   // Quick fade + scale

// Toast
<Animated animation="toast">     // Slide in from bottom

// Error states
<Animated animation="shake">     // Shake for errors
```

## Custom Animation Config

Create custom animations with the AnimationConfig interface:

```tsx
import { type AnimationConfig } from './lib/animation.tsx';

const customAnimation: AnimationConfig = {
  initial: { opacity: 0, transform: 'rotate(-10deg) scale(0.9)' },
  animate: { opacity: 1, transform: 'rotate(0) scale(1)' },
  exit: { opacity: 0, transform: 'rotate(10deg) scale(0.9)' },
  transition: { duration: 0.4, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
};

<Animated animation={customAnimation}>
  Custom animated content
</Animated>
```

**AnimationConfig properties:**
- `initial` - Starting state (CSS properties)
- `animate` - End state (CSS properties)
- `exit` - Exit state (CSS properties)
- `transition` - Timing options
  - `duration` - Seconds
  - `delay` - Seconds
  - `ease` - Easing function or cubic-bezier

## Component Animation Integration

### Button Animations
```tsx
import { Button } from './components/mod.ts';

// Built-in hover animations
<Button animate="lift">Lifts on hover</Button>
<Button animate="scale">Scales on hover</Button>
<Button animate="glow">Glows on hover</Button>
<Button animate={false}>No animation</Button>

// Press animation (default)
<Button>Presses down when clicked</Button>
```

### Card Animations
```tsx
import { Card } from './components/mod.ts';

// Entrance animation
<Card animate="fade-up">Fades up on mount</Card>

// Scroll-triggered
<Card animate="fade-up" trigger="in-view">Reveals on scroll</Card>

// Hover effects
<Card hover="lift">Lifts on hover</Card>
<Card hover="scale">Scales on hover</Card>
<Card hover="glow">Glows on hover</Card>
<Card hover="border">Border highlight</Card>

// With delay (for staggering)
<Card animate="fade-up" delay={0.1}>First</Card>
<Card animate="fade-up" delay={0.2}>Second</Card>
<Card animate="fade-up" delay={0.3}>Third</Card>
```

### Modal Animations
```tsx
import { Modal } from './components/mod.ts';

<Modal isOpen={isOpen} onClose={onClose} animation="zoom">
  Zoom animation (default)
</Modal>

<Modal isOpen={isOpen} onClose={onClose} animation="slide">
  Slide animation
</Modal>

<Modal isOpen={isOpen} onClose={onClose} animation="fade">
  Simple fade
</Modal>
```

## Triggers

### Mount (Default)
Animation plays when component mounts.
```tsx
<Animated animation="fade-up">Animates on mount</Animated>
```

### Hover
Animation plays on hover.
```tsx
<Animated animation="scale-up" trigger="hover">
  Scales on hover
</Animated>
```

### Press
Animation plays when pressed/clicked.
```tsx
<Animated animation="scale-pop" trigger="press">
  Pops when clicked
</Animated>
```

### In-View
Animation plays when element enters viewport.
```tsx
<Animated animation="fade-up" trigger="in-view">
  Reveals when scrolled into view
</Animated>
```

## Common Patterns

### Page Transitions
```tsx
// Route/page transition
<Animated animation="fade-up" duration={0.3}>
  <main>{pageContent}</main>
</Animated>
```

### Loading States
```tsx
// Skeleton with pulse
<Skeleton />

// Spinning loader
<Animated animation="spin" trigger="mount">
  <LoaderIcon />
</Animated>
```

### Notification Toasts
```tsx
// Toast container with stagger
<StaggerContainer staggerDelay={0.1}>
  {toasts.map(toast => (
    <AnimatePresence key={toast.id} show={true} animation="toast">
      <Toast {...toast} />
    </AnimatePresence>
  ))}
</StaggerContainer>
```

### Dropdown Menu
```tsx
<AnimatePresence show={isOpen} animation="dropdown">
  <DropdownContent>
    {items.map(item => (
      <DropdownItem key={item.id}>{item.label}</DropdownItem>
    ))}
  </DropdownContent>
</AnimatePresence>
```

### Accordion/Collapsible
```tsx
<AnimatePresence show={isOpen} animation="expand">
  <CollapsibleContent>
    {content}
  </CollapsibleContent>
</AnimatePresence>
```

### Error Shake
```tsx
const [error, setError] = useState(false);

<Animated animation={error ? "shake" : undefined}>
  <Input state={error ? "error" : "default"} />
</Animated>

// Trigger shake on validation fail
<button onClick={() => {
  if (!isValid) {
    setError(true);
    setTimeout(() => setError(false), 500);
  }
}}>
  Submit
</button>
```

## useMotion Hook

For programmatic animations:

```tsx
import { useMotion } from './lib/animation.tsx';

function MyComponent() {
  const ref = useRef<HTMLDivElement>(null);
  const { animate, stop } = useMotion(ref, {
    duration: 0.5,
    easing: 'ease-out'
  });

  const handleClick = () => {
    animate({
      transform: ['scale(1)', 'scale(1.2)', 'scale(1)'],
      opacity: [1, 0.8, 1]
    });
  };

  return (
    <div ref={ref} onClick={handleClick}>
      Click to animate
    </div>
  );
}
```

## Reduced Motion Support

All animations respect `prefers-reduced-motion`:

```css
/* Automatically applied */
@media (prefers-reduced-motion: reduce) {
  .animated {
    transition: none !important;
    animation: none !important;
  }
}
```

## Animation Registry

The MCP includes an animation registry for AI assistance:

```typescript
// Animation presets organized by category
const animationRegistry = {
  fade: {
    'fade-in': { description: 'Simple opacity fade', css: 'opacity 0→1' },
    'fade-up': { description: 'Fade with upward motion', css: 'opacity + translateY' },
    // ...
  },
  scale: {
    'scale-in': { description: 'Scale from 0 to 1', css: 'transform: scale' },
    'scale-pop': { description: 'Bouncy scale effect', css: 'scale with overshoot' },
    // ...
  },
  component: {
    'modal': { description: 'Scale + fade for modals', duration: 0.3 },
    'dropdown': { description: 'Scale + slide for menus', duration: 0.2 },
    // ...
  }
};
```

## MCP Tools for Animation

- `list_animations` - List all animation presets
- `generate_animated_component` - Create component with animation
- `suggest_animation` - Get animation suggestions

## Performance Tips

1. **Use CSS transforms** - Animations use `transform` and `opacity` for GPU acceleration
2. **Avoid animating layout** - Don't animate `width`, `height`, `top`, `left`
3. **Use `will-change`** - Applied automatically on animated elements
4. **Limit simultaneous animations** - Use `StaggerContainer` to space them out
5. **Respect reduced motion** - Always support `prefers-reduced-motion`

## Easing Functions

Common easings available:
- `linear` - Constant speed
- `ease` - Default easing
- `ease-in` - Slow start
- `ease-out` - Slow end
- `ease-in-out` - Slow start and end
- `cubic-bezier(0.34, 1.56, 0.64, 1)` - Bouncy overshoot

## Troubleshooting

**Animation not playing?**
- Check `show` prop is true
- Verify animation preset name is correct
- Check for CSS conflicts

**Choppy animation?**
- Use `transform` and `opacity` only
- Check browser DevTools Performance tab
- Reduce other simultaneous animations

**Animation on mount not working?**
- Use `trigger="mount"` explicitly
- Ensure component is actually mounting (not just updating)
