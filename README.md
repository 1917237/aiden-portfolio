# Aiden Luo — Portfolio

Empty outdoor-engineer portfolio shell. Content is driven by JSON; media lives in `public/media/`.

## Run locally

```bash
cd ~/Projects/aiden-portfolio
npm install
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**).

## Edit content (no code required for most updates)

| What | File |
|------|------|
| Name, tagline, about, contact, current project | `src/content/site.json` |
| Projects (story, gallery, videos, 3D) | `src/content/projects.json` |
| Project field guide | `src/content/projects/_template.json` |
| Images / `.glb` / `.mp4` | `public/media/...` |

### Currently building

Set `home.currentProjectSlug` in `site.json` to a project `slug`. That project appears in a **Currently building** strip on the home page. Clear the field (empty string) to hide the strip.

### Videos

In a project entry, add a `videos` array:

```json
"videos": [
  { "type": "youtube", "id": "YOUTUBE_VIDEO_ID", "title": "Demo" },
  { "type": "file", "src": "/media/projects/your-slug/demo.mp4", "title": "Close-up" }
]
```

YouTube `id` is the part after `v=` in a watch URL. File videos live under `public/media/projects/<slug>/`.


### Add a project

1. Copy fields from `_template.json` into the `projects` array in `projects.json`.
2. Set a unique `slug` (URL becomes `/projects/your-slug`).
3. Drop files into `public/media/projects/your-slug/`.
4. Point `coverImage`, `gallery`, and `model` at those paths (start with `/media/...`).

The **gallery** for a project lives on that project's page — add image paths to the project's `gallery` array.

### 3D models

Export **GLB** from Fusion 360 or Onshape, put it under `public/media/projects/<slug>/`, and set `"model"` in that project entry. The project page includes an orbit / zoom / pan viewer.

## Pages

- `/` Home
- `/projects` Project list
- `/projects/:slug` Project detail (story + 3D + gallery)
- `/about` About
- `/resume` Resume (view, zoom, download)
- `/contact` Contact
