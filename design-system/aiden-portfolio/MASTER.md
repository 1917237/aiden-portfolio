# Aiden Luo — Portfolio Design System

> **LOGIC:** Page files in `pages/` override this Master when present.

**Updated:** 2026-09-08  
**Audience:** Recruiters / eng peers  
**Style base (UI UX Pro Max):** Minimalism & Swiss · variance 3 · density 4  
**Motion:** Quiet letter stagger + scroll reveal  

---

## Override note (anti–AI-default)

Rejected:
- Neon HUD / phosphor green
- Copper-on-black costume industrial
- Purple SaaS gradients
- Process grids (“How I work”) and chatty marketing copy

**Locked:** dark mesh atmosphere + muted green accent + short personal copy + compact work list.

## Color

| Role | Hex | Token |
|------|-----|--------|
| Background | `#050706` | `--color-bg` |
| Elevated | `#0C1210` | `--color-bg-elevated` |
| Ink | `#E8EDE9` | `--color-ink` |
| Muted | `#8F9C94` | `--color-ink-muted` |
| Accent | `#5A8F6C` | `--color-sage` |
| Accent lift | `#7AAF8A` | `--color-sage-deep` |
| Line | `#1C2A22` | `--color-line` |

Atmosphere: dual Paper MeshGradient + veil. Reduced motion → `speed={0}`.

## Typography

- **Display:** Archivo — semibold, not extrabold  
- **Body:** Space Grotesk  
- **Mono:** IBM Plex Mono — labels only  

Scale: name ~2.5–4.25rem · section ~1.25–1.5rem · body ~0.875–0.95rem · labels ~0.65rem

## Layout

1. Centered hero: name · one line · short support · Work / Contact · optional current project  
2. Full project list lives only on `/projects`  
3. No duplicate work section on home  

Section padding ~64–80px. Fewer words > more sections.

Tutoring stays under `.tutoring-app`.
