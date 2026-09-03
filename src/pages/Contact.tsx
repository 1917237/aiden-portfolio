import { hasValue, siteContent } from '../lib/content'

export function Contact() {
  const { email, phone, links } = siteContent
  const extras = links.other ?? []

  const rows = [
    hasValue(email) ? { label: 'Email', value: email, href: `mailto:${email}` } : null,
    hasValue(phone) ? { label: 'Phone', value: phone, href: `tel:${phone}` } : null,
    hasValue(links.github)
      ? { label: 'GitHub', value: links.github, href: links.github }
      : null,
    hasValue(links.linkedin)
      ? { label: 'LinkedIn', value: links.linkedin, href: links.linkedin }
      : null,
    ...extras
      .filter((item) => hasValue(item.label) && hasValue(item.url))
      .map((item) => ({ label: item.label, value: item.url, href: item.url })),
  ].filter(Boolean) as { label: string; value: string; href: string }[]

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
      <p className="text-sm font-medium tracking-wide text-sage uppercase">Contact</p>
      <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">Get in touch</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-muted">
        Links stay empty until you fill them in <code>src/content/site.json</code>.
      </p>

      <div className="mt-10 max-w-xl border border-line bg-bg-elevated/60">
        {rows.length === 0 ? (
          <div className="space-y-3 px-6 py-8 text-ink-muted">
            <p className="font-medium text-ink">No contact links yet</p>
            <p>
              Set <code>email</code>, <code>phone</code>, <code>links.github</code>, and{' '}
              <code>links.linkedin</code> when you are ready. Optional extras go in{' '}
              <code>links.other</code>.
            </p>
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.label} className="border-b border-line last:border-b-0">
                <a
                  href={row.href}
                  className="flex items-baseline justify-between gap-4 px-6 py-5 transition hover:bg-bg"
                  target={row.href.startsWith('http') ? '_blank' : undefined}
                  rel={row.href.startsWith('http') ? 'noreferrer' : undefined}
                >
                  <span className="text-sm font-semibold tracking-wide text-sage uppercase">
                    {row.label}
                  </span>
                  <span className="text-right text-ink break-all">{row.value}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
