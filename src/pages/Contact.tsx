import { useState, type FormEvent } from 'react'
import { Reveal } from '../components/Reveal'
import { usePortfolio } from '../lib/PortfolioContext'

const fieldClass =
  'mt-2 w-full border-0 border-b border-line bg-transparent px-0 py-2.5 text-base text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-sage'

type Status = 'idle' | 'sending' | 'sent' | 'error'

function MessageForm({ toEmail }: { toEmail: string }) {
  const [name, setName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!toEmail.trim()) {
      setStatus('error')
      setError('Email is not set up yet. Try again later.')
      return
    }

    setStatus('sending')
    setError('')

    try {
      const response = await fetch(
        `https://formsubmit.co/ajax/${encodeURIComponent(toEmail.trim())}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: name.trim(),
            email: fromEmail.trim(),
            subject: subject.trim(),
            message: message.trim(),
            _subject: subject.trim() || `Portfolio message from ${name.trim() || 'someone'}`,
            _template: 'table',
            _captcha: 'false',
          }),
        },
      )

      const payload = (await response.json().catch(() => null)) as
        | { success?: string | boolean; message?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.message || 'Could not send message.')
      }

      setStatus('sent')
      setName('')
      setFromEmail('')
      setSubject('')
      setMessage('')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not send message.')
    }
  }

  if (!toEmail.trim()) {
    return (
      <div className="border border-dashed border-line px-6 py-10 text-center text-ink-muted">
        <p className="font-medium text-ink">Inbox not ready</p>
        <p className="mt-2 text-sm">Add your email in Portfolio admin first.</p>
      </div>
    )
  }

  if (status === 'sent') {
    return (
      <div className="py-8 text-center">
        <p className="font-display text-2xl font-semibold text-ink">Sent</p>
        <p className="mt-2 text-sm text-ink-muted">I’ll get back to you soon.</p>
        <button type="button" className="btn-ghost mt-8" onClick={() => setStatus('idle')}>
          Write another
        </button>
      </div>
    )
  }

  return (
    <form className="space-y-7 text-left" onSubmit={onSubmit} noValidate={false}>
      <div className="grid gap-7 sm:grid-cols-2">
        <label className="block">
          <span className="label-mono">Name</span>
          <input
            className={fieldClass}
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === 'sending'}
          />
        </label>

        <label className="block">
          <span className="label-mono">Your email</span>
          <input
            className={fieldClass}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            disabled={status === 'sending'}
          />
        </label>
      </div>

      <label className="block">
        <span className="label-mono">Subject</span>
        <input
          className={fieldClass}
          name="subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={status === 'sending'}
        />
      </label>

      <label className="block">
        <span className="label-mono">Message</span>
        <textarea
          className={`${fieldClass} min-h-[140px] resize-y`}
          name="message"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={status === 'sending'}
        />
      </label>

      {status === 'error' && error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary px-8" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

export function Contact() {
  const { siteContent, hasValue } = usePortfolio()
  const { email } = siteContent
  const hasEmail = hasValue(email)

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(90,143,108,0.1),transparent_70%)]" />

      <div className="relative mx-auto grid max-w-5xl gap-12 px-5 py-16 md:grid-cols-[0.9fr_1.1fr] md:items-start md:gap-16 md:px-8 md:py-24">
        <Reveal immediate>
          <p className="label-mono">Contact</p>
          <h1 className="mt-4 font-display text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.05] tracking-tight text-ink">
            Let’s get in touch
          </h1>
          <p className="mt-4 max-w-sm text-base leading-relaxed text-ink-muted md:text-lg">
            Open to project chats, collaborations, or just a hello.
          </p>
        </Reveal>

        <Reveal delayMs={80}>
          {hasEmail ? (
            <div id="message" className="scroll-mt-24 border-t border-line pt-8 md:border-t-0 md:pt-0">
              <MessageForm toEmail={email} />
            </div>
          ) : (
            <div className="border border-dashed border-line px-6 py-10 text-ink-muted">
              <p className="font-medium text-ink">Contact coming soon</p>
              <p className="mt-2 text-sm">Add email in Portfolio admin.</p>
            </div>
          )}
        </Reveal>
      </div>
    </div>
  )
}
