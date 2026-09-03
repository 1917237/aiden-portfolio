# Tutoring app backlog

Audit of student + admin surfaces. Use this to track fixes before and after go-live.

**Last reviewed:** 2026-09-01

---

## In progress

- [ ] **Student: meeting link** on lesson cards (Zoom/Meet URL)

---

## Student side — done

- [x] One page (Schedule + My classes merged)
- [x] Credit copy aligned (`studentCreditCopy.ts`)
- [x] Tap upcoming lesson → cancel/reschedule modal
- [x] Reschedule with booking grid + duration picker (migrations 36–37)
- [x] Credit history ledger (`credit_ledger` + UI in credits panel, migration 37)
- [x] Timezone saved on profile (`display_timezone`, migration 37)
- [x] Dead code removed (`CalendarDayPanel`, `ReschedulePicker`, profile section variant)

## Student side — intentional / skip

- **No link between portfolio and tutoring** — tutoring is a separate app at `/tutoring/*`; portfolio visitors should not discover it and vice versa.
- **Notification → class deep links** — not needed.
- **Login “Student login”** — low priority cosmetic.

---

## Student side — still open

| Priority | Item | Notes |
|----------|------|-------|
| **High** | Meeting link / how to join | Zoom/Meet on lesson cards |
| Later | Online payment (Stripe) | Manual Zelle request OK for now |
| Later | Email / push notifications | Deferred |

---

## Admin side

### Missing

| Priority | Item | Notes |
|----------|------|-------|
| High | Upcoming agenda on dashboard | Only “ready to confirm” today |
| High | Student invite / create account | Supabase manual |
| High | See student email | Profile is name + rate + balance |
| Medium | Admin calendar sync UI | Backend in migration 35 |
| Medium | Payment / credit ledger UI | Ledger exists; admin view optional |
| Medium | Act on lessons from Students page | Drawer read-only |
| Medium | View / manage weekly series | Students can stop; tutor has no view |
| Low | Manual credit deduct / refund | Add only today |
| Later | Email parents on book/cancel | Deferred |

### Unnecessary / trim

| Item | Action |
|------|--------|
| “Load demo data” on Calendar | Hide before real students |
| Two timezone pickers on admin dashboard | Keep one |
| Login “Student login” copy | Shared page — relabel |

---

## Cross-cutting

| Item | Notes |
|------|-------|
| Run migrations **33–42** in Supabase SQL editor | In order |
| Deploy `calendar-feed` edge function | After migration 35 |
| Supabase Auth redirect URLs | Include `/tutoring/reset-password` |
| Notifications capped at 20 | No pagination |

---

## Go-live checklist

1. Run migrations **33** through **37** in Supabase SQL editor
2. Deploy `npx supabase functions deploy calendar-feed --project-ref <ref>`
3. Auth redirect URLs for production domain + reset-password
4. Hide / remove **Load demo data** on calendar
5. Add meeting link (global or per-lesson)
6. Buy domain + point DNS (e.g. Spaceship `aidenluo.com`)

---

## Nice later (skip for now)

- Waitlist / next available slot
- Mobile When2Meet tap targets
- Notification realtime badge
- GitHub Action for CI
- Migration README for production
- Multi-tutor support
