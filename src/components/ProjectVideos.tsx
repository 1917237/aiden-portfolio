import type { ProjectVideo } from '../lib/types'
import { hasValue } from '../lib/content'
import { Placeholder } from './Placeholder'

type ProjectVideosProps = {
  videos?: ProjectVideo[]
  projectSlug: string
}

function YoutubeEmbed({ id, title }: { id: string; title?: string }) {
  return (
    <div>
      {title ? <p className="mb-3 text-sm font-medium text-ink-muted">{title}</p> : null}
      <div className="aspect-video w-full overflow-hidden border border-line bg-ink/5">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title={title || 'Project video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  )
}

function FileVideo({ src, title }: { src: string; title?: string }) {
  return (
    <div>
      {title ? <p className="mb-3 text-sm font-medium text-ink-muted">{title}</p> : null}
      <video
        className="aspect-video w-full border border-line bg-ink/5 object-contain"
        src={src}
        controls
        playsInline
        preload="metadata"
      >
        Your browser does not support embedded video.
      </video>
    </div>
  )
}

export function ProjectVideos({ videos, projectSlug }: ProjectVideosProps) {
  const items = videos ?? []

  return (
    <section className="border-t border-line py-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">Videos</h2>
      <p className="mt-2 max-w-2xl text-ink-muted">
        YouTube embeds or files in <code>public/media/projects/{projectSlug}/</code>.
      </p>

      <div className="mt-6 grid gap-8">
        {items.length === 0 ? (
          <>
            <Placeholder
              label="YouTube embed"
              hint='Add { "type": "youtube", "id": "VIDEO_ID", "title": "Demo" } to videos[]'
              aspect="video"
            />
            <Placeholder
              label="Attached video file"
              hint={`Add { "type": "file", "src": "/media/projects/${projectSlug}/demo.mp4" }`}
              aspect="video"
            />
          </>
        ) : (
          items.map((video, index) => {
            if (video.type === 'youtube') {
              if (!hasValue(video.id)) {
                return (
                  <Placeholder
                    key={`yt-${index}`}
                    label={video.title || 'YouTube embed'}
                    hint="Set the YouTube video id in projects.json"
                    aspect="video"
                  />
                )
              }
              return (
                <YoutubeEmbed
                  key={`yt-${video.id}-${index}`}
                  id={video.id}
                  title={video.title}
                />
              )
            }

            if (!hasValue(video.src)) {
              return (
                <Placeholder
                  key={`file-${index}`}
                  label={video.title || 'Attached video file'}
                  hint={`Drop an .mp4 in public/media/projects/${projectSlug}/ and set src`}
                  aspect="video"
                />
              )
            }

            return (
              <FileVideo
                key={`file-${video.src}-${index}`}
                src={video.src}
                title={video.title}
              />
            )
          })
        )}
      </div>
    </section>
  )
}
