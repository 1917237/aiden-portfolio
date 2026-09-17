# Media — where images live

One rule: folder name = project `slug` in `src/content/projects.json`.

```
public/media/projects/<slug>/cover.jpg     ← Work list + Current thumb
public/media/projects/<slug>/gallery-1.jpg ← detail page photos
public/media/about/portrait.jpg            ← About page
```

In JSON, paths start with `/media/...` (maps to `public/media/...`).

| Project | Put files here | Set `coverImage` to |
|---------|----------------|---------------------|
| Fog collector | `public/media/projects/fog-collector-door-mechanism/` | `/media/projects/fog-collector-door-mechanism/...` |
| Sentinel AI | `public/media/projects/sentinel-ai/` | `/media/projects/sentinel-ai/cover.jpg` |
| Pan-tilt | `public/media/projects/pan-tilt-tracking-turret/` | `/media/projects/pan-tilt-tracking-turret/cover.jpg` |

Text = `src/content/*.json`. Pictures = `public/media/...`.
