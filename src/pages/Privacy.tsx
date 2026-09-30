import { Reveal } from '../components/Reveal'
import { usePortfolio } from '../lib/PortfolioContext'

const sections = [
  {
    title: 'What this site collects',
    body: 'Students who are invited to the tutoring portal have an account with their name, email, lesson bookings, and credit balance. Messages sent through the contact form include the name, email, and message you enter.',
  },
  {
    title: 'Google Calendar',
    body: 'The tutor can connect his own Google Calendar. The site then creates, updates, and removes tutoring lessons in that calendar and adds the student as a guest so Google sends them the invite. It only uses access to calendar events for tutoring lessons and never reads or changes other events.',
  },
  {
    title: 'How data is used',
    body: 'Information is used only to schedule lessons, send reminders and invites, and keep track of payments. It is never sold or shared for advertising.',
  },
  {
    title: 'Where data is stored',
    body: 'Account and booking data is stored with Supabase. Calendar events live in Google Calendar. Access is limited to the tutor and each student for their own lessons.',
  },
  {
    title: 'Removing your data',
    body: 'Ask to have your account and lessons deleted at any time using the contact below, and it will be removed. The tutor can disconnect Google Calendar at any time, which stops all syncing.',
  },
]

export function Privacy() {
  const { siteContent, hasValue } = usePortfolio()
  const email = siteContent.email

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
      <Reveal immediate>
        <p className="label-mono">Privacy</p>
        <h1 className="mt-4 font-display text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.05] tracking-tight text-ink">
          Privacy policy
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted">
          How aidenluo.com and its tutoring portal handle your information.
        </p>
      </Reveal>

      <div className="mt-12 space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-display text-xl font-semibold text-ink">{section.title}</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">{section.body}</p>
          </section>
        ))}

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Contact</h2>
          <p className="mt-3 leading-relaxed text-ink-muted">
            {hasValue(email) ? (
              <>
                Questions or deletion requests:{' '}
                <a className="text-ink underline" href={`mailto:${email}`}>
                  {email}
                </a>
              </>
            ) : (
              'Questions or deletion requests: use the contact page.'
            )}
          </p>
        </section>
      </div>
    </div>
  )
}
