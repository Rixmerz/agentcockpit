---
name: fresh-ui-components
description: |
  Comprehensive UI component library skill for Deno Fresh + Preact applications.
  
  Use this skill when:
  - Building Deno Fresh applications with Preact
  - Need to use UI components (Button, Card, Modal, Table, etc.)
  - Creating forms with validation
  - Building admin dashboards, ERP, CRM, or SaaS interfaces
  - Working with layout components (Navbar, Hero, Features, Pricing, etc.)
  - Need drag-drop (Kanban), calendars, file uploads
  - Creating data visualization with charts
  - Building multi-step wizards or complex forms
  - Need e-commerce product catalogs or order management
  
  Provides 40+ UI components, 14 interactive islands, and 10 animated backgrounds
  with full TypeScript support and MCP integration.
---

# Fresh UI Components Skill

Complete component library for Deno Fresh + Preact with 40+ UI components, 14 islands, and 10 animated backgrounds.

## Quick Reference

```typescript
// Import from central module
import { 
  Button, Card, Modal, Input,
  Navbar, Hero, FeatureSection,
  Calendar, Kanban, DataTable 
} from './components/mod.ts';
```

## Component Categories

### Primitives (10 components)
- **Button** - Variants: default, destructive, outline, secondary, ghost, link, soft
  - Props: `variant`, `size`, `loading`, `animate`, `leftIcon`, `rightIcon`
  - Animation: `animate="lift" | "scale" | "glow"`
  
- **Input** - Text inputs with icons and validation
  - Props: `variant`, `size`, `state`, `leftIcon`, `rightIcon`
  
- **Textarea** - Multi-line text with resize control
  - Props: `variant`, `resize`, `rows`
  
- **Select** - Dropdown selection
  - Props: `options`, `value`, `onChange`, `placeholder`
  
- **Checkbox** - Check toggles
  - Props: `size`, `variant`, `checked`, `onChange`
  
- **Radio** - Radio button groups
  - Props: `size`, `name`, `value`, `checked`
  
- **Switch** - Toggle switches
  - Props: `size`, `checked`, `onChange`
  
- **Badge** - Status indicators
  - Props: `variant`, `size`, `dot`
  
- **Avatar** - Profile images with fallbacks
  - Props: `size`, `src`, `alt`, `fallback`, `border`
  
- **Skeleton** - Loading placeholders
  - Props: `variant`, `width`, `height`

### Layout Components (11)
- **Navbar** - Responsive navigation with mobile menu
  - Props: `logo`, `items`, `cta`, `sticky`, `transparent`
  
- **Hero** - Hero sections with animations
  - Props: `badge`, `headline`, `description`, `actions`, `align`, `size`
  
- **FeatureSection** - Feature showcases
  - Props: `title`, `description`, `features`, `layout`, `columns`
  
- **TestimonialSection** - Customer testimonials
  - Props: `title`, `description`, `testimonials`, `layout`
  
- **PricingTable** - Pricing cards and comparison
  - Props: `title`, `description`, `tiers`, `columns`
  
- **StatsSection** - Statistics display with animated numbers
  - Props: `title`, `description`, `stats`, `layout`, `animatedNumbers`
  
- **CTA** - Call-to-action sections
  - Props: `title`, `description`, `primaryAction`, `variant`
  
- **FAQ** - Accordion-based FAQ
  - Props: `title`, `description`, `items`, `variant`
  
- **Newsletter** - Newsletter signup forms
  - Props: `title`, `description`, `buttonText`, `onSubmit`
  
- **SiteFooter** - Multi-column footers
  - Props: `logo`, `sections`, `socialLinks`, `newsletter`

### Overlay Components (6)
- **Modal** - Dialog with animations
  - Props: `isOpen`, `onClose`, `size`, `animation`, `closeOnOverlayClick`
  - Animation: `animation="zoom" | "slide" | "fade"`
  
- **Sheet** - Side panels (drawers)
  - Props: `open`, `onClose`, `side`, `size`
  - Side: `side="left" | "right" | "top" | "bottom"`
  
- **Popover** - Positioned content panels
  - Props: `open`, `onOpenChange`, `side`, `align`
  
- **Dropdown** - Dropdown menus
  - Props: `trigger`, `items`, `align`
  
- **Tooltip** - Hover tooltips
  - Props: `content`, `position`, `delay`
  
- **Collapsible** - Expand/collapse panels
  - Props: `open`, `onOpenChange`

### Navigation (4)
- **Tabs** - Tab panels with animated indicator
  - Props: `value`, `onChange`, `items`, `variant`
  
- **Accordion** - Collapsible sections
  - Props: `type`, `value`, `onValueChange`, `collapsible`
  
- **Breadcrumb** - Navigation paths
  - Props: `items`, `separator`, `maxItems`
  
- **Pagination** - Page navigation
  - Props: `currentPage`, `totalPages`, `onChange`

### Feedback (4)
- **Alert** - Notification alerts
  - Variants: `default`, `info`, `success`, `warning`, `error`, `destructive`
  - Props: `variant`, `size`, `dismissible`, `icon`, `title`
  
- **Progress** - Progress bars
  - Props: `value`, `max`, `size`, `variant`, `animated`
  
- **Toast** - Toast notifications
  - Use: `toast({ title: "Success", description: "Item saved" })`
  
- **Command** - Command palette
  - Props: `open`, `onOpenChange`, `placeholder`

### Form Components (3)
- **FormBuilder** - Schema-driven forms
  - Props: `schema`, `defaultValues`, `onSubmit`
  
- **Slider** - Range inputs
  - Props: `value`, `min`, `max`, `step`, `disabled`
  
- **Switch** - Toggle inputs (also in primitives)

## Islands (Interactive Components)

### Data & Display
- **Calendar** - Full calendar with events
  - Props: `value`, `onChange`, `events`, `view`
  
- **Charts** - Data visualization (bar, line, pie, area)
  - Props: `type`, `data`, `options`
  
- **DataTable** - Sortable, filterable tables
  - Props: `columns`, `data`, `pagination`, `sorting`
  
- **TreeView** - Hierarchical tree navigation
  - Props: `data`, `expandedKeys`, `onExpand`, `draggable`

### Input & Selection
- **ColorPicker** - Color selection
  - Props: `value`, `onChange`, `format`, `presetColors`
  
- **Combobox** - Searchable dropdown
  - Props: `options`, `value`, `onChange`, `searchable`, `creatable`
  
- **ImageCropper** - Image cropping
  - Props: `src`, `onCrop`, `aspectRatio`, `circular`
  
- **MultiSelect** - Multiple selection
  - Props: `options`, `value`, `onChange`, `creatable`
  
- **FileUpload** - Drag & drop file upload
  - Props: `accept`, `multiple`, `maxSize`, `onUpload`

### Advanced
- **Kanban** - Drag-drop task board
  - Props: `columns`, `tasks`, `onMove`
  
- **SortableList** - Reorderable lists
  - Props: `items`, `onReorder`, `handle`
  
- **Stepper** - Multi-step wizards
  - Props: `steps`, `currentStep`, `onStepChange`, `orientation`
  
- **InfiniteScroll** - Virtualized scrolling
  - Props: `loadMore`, `hasMore`, `threshold`
  
- **RichTextEditor** - Text editor
  - Props: `value`, `onChange`, `placeholder`, `toolbar`

## Backgrounds (10 Animated)

```tsx
import { 
  AnimatedGradient, Aurora, Particles,
  MeshGradient, Waves, BlurBlob,
  Spotlight, GridPattern, DotPattern, NoiseTexture 
} from './backgrounds/mod.ts';
```

- **AnimatedGradient** - Shifting color gradients
- **Aurora** - Northern lights effect
- **Particles** - Stars, snow, fireflies, tech grid
- **MeshGradient** - Organic blob gradients
- **Waves** - Animated wave SVGs
- **BlurBlob** - Soft blurred blobs
- **Spotlight** - Focus spotlights
- **GridPattern** - Grid overlays
- **DotPattern** - Dotted patterns
- **NoiseTexture** - Film grain effects

## Usage Patterns

### Component with Animation
```tsx
// Button with animation
<Button animate="lift" size="lg">
  Click Me
</Button>

// Card with scroll reveal
<Card animate="fade-up" trigger="in-view">
  Content
</Card>

// Card with hover effect
<Card hover="glow">
  Hover over me
</Card>
```

### Form Building
```tsx
import { FormBuilder } from './components/mod.ts';

const schema = {
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'password', type: 'password', label: 'Password', minLength: 8 },
    { name: 'role', type: 'select', label: 'Role', options: ['Admin', 'User'] }
  ]
};

<FormBuilder schema={schema} onSubmit={handleSubmit} />
```

### Modal Usage
```tsx
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from './components/mod.ts';

<Modal isOpen={isOpen} onClose={onClose} size="lg" animation="zoom">
  <ModalHeader>
    <ModalTitle>Confirm Action</ModalTitle>
    <ModalDescription>Are you sure you want to proceed?</ModalDescription>
  </ModalHeader>
  <ModalFooter>
    <Button variant="outline" onClick={onClose}>Cancel</Button>
    <Button onClick={confirm}>Confirm</Button>
  </ModalFooter>
</Modal>
```

### Island Usage (Client-side)
```tsx
// islands/my-page.tsx
import { Calendar } from '../components/mod.ts';

export default function MyPage() {
  return <Calendar value={date} onChange={setDate} events={events} />;
}
```

### Background Usage
```tsx
<AnimatedGradient colors={['#ff0080', '#7928ca', '#ff0080']} speed={10}>
  <Hero headline="Welcome" description="..." />
</AnimatedGradient>
```

## Component Architecture

### File Structure
```
components/
├── button/mod.tsx      # Component implementation
├── card/mod.tsx
├── modal/mod.tsx
└── mod.ts              # Central exports

islands/
├── calendar/mod.tsx    # Interactive island
├── kanban/mod.tsx
└── ...

backgrounds/
├── animated-gradient.tsx
├── aurora.tsx
└── mod.ts
```

### CVA Pattern
All components use Class Variance Authority:
```tsx
const buttonVariants = cva({
  base: 'inline-flex items-center justify-center rounded-md',
  variants: {
    variant: {
      default: 'bg-primary text-white',
      destructive: 'bg-red-500 text-white',
      outline: 'border border-input bg-background',
    },
    size: {
      default: 'h-10 px-4',
      sm: 'h-8 px-3',
      lg: 'h-12 px-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});
```

## MCP Integration

The library includes MCP tools for AI assistance:

- `list_components` - List all components with animation info
- `get_component` - Get component details
- `generate_component` - Create new component boilerplate
- `suggest_animation` - Get animation recommendations

## Type Safety

All components export their prop types:
```tsx
import { type ButtonProps, type CardProps } from './components/mod.ts';
```

## Common Props

Most components support:
- `className` - Additional CSS classes
- `variant` - Visual variant
- `size` - Size variant
- `animate` - Animation preset
- `hover` - Hover effect
- `trigger` - Animation trigger
