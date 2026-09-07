# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/aiden-tutoring/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Aiden Tutoring  
**Updated:** 2026-09-07  
**Audience:** Teens / college · 1:1 tutoring booking  
**Style base (UI UX Pro Max):** Minimalism & Swiss Style (variance 3, motion 3, density 6)  
**Override note:** Auto palette suggested purple/lavender — rejected as generic AI. Locked calm ink + forest green instead.

---

## Global Rules

### Color Palette (scoped to `.tutoring-app`)

| Role | Hex | Maps to existing tutoring utility |
|------|-----|-----------------------------------|
| Background | `#F3F4F1` | `--color-bg` |
| Elevated / card | `#FFFFFF` | `--color-bg-elevated` |
| Ink | `#18201C` | `--color-ink` |
| Muted ink | `#5A645C` | `--color-ink-muted` |
| Primary / accent | `#2D6A4F` | `--color-sage` |
| Primary deep (CTA) | `#1B4332` | `--color-sage-deep` |
| Secondary cool | `#4A6670` | `--color-sky` |
| Neutral stone | `#7A7F76` | `--color-stone` |
| Soft fill | `#E7E9E3` | `--color-sand` |
| Border | `#D5D9D2` | `--color-line` |
| Destructive | `#B91C1C` | red utilities |
| Focus ring | `#2D6A4F` | sage |

**Atmosphere:** Quiet paper field, soft moss wash in the corner — no purple, no glassmorphism stacks, no glow.

### Typography

- **Display / headings:** [Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) — academic, calm, trustworthy  
- **Body / UI:** [Manrope](https://fonts.google.com/specimen/Manrope) — modern, clean, readable on dashboards  

**Google Fonts:**
```
https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap
```

### Spacing

Standard density: 8 / 16 / 24 / 32 / 48. Sections breathe; avoid dashboard clutter.

### Motion

Subtle only (150–250ms). Respect `prefers-reduced-motion`. Keep existing confirm shake/success — do not add hero parallax or glass blur.

### Anti-patterns (do not use)

- Purple / indigo SaaS gradients  
- Kids / playful fonts (Baloo, Comic Neue)  
- Glassmorphism stacks, neon glow, rounded-full pill clusters  
- Emoji as icons  
- Changing product behavior — **visual only**

### Product constraints

Keep all tutoring capabilities: credits, upcoming/join, book, classes calendar, cancel/reschedule, weekly stop, notifications, timezone, profile menu.
