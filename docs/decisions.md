# Decision log

Record every change to a decision made in `ARCHITECTURE.md`, `DESIGN.md` or `RESEARCH.md` here **before** changing the code or those documents. Newest entries at the top.

Format: date, decision, why, what it replaces.

## 2026-10-21 - Stack changed to Next.js, Supabase, Clerk, Resend, Gemini/Groq
- **Decision:** Next.js on Vercel (single app), Supabase Postgres and Storage, Clerk for auth, Resend for email, Vercel Cron for jobs, Gemini or Groq for the HR assistant agent.
- **Why:** managed services suit a 180-person company and a small team; one deployable app.
- **Replaces:** the first draft in `ARCHITECTURE.md` (React + NestJS + Prisma + Redis/BullMQ + self-managed JWT auth).

## 2026-10-21 - Project scope and modules
- **Decision:** Konkan Coastal Foods HRMS for 180 employees (Panaji head office, Verna plant). Modules: employees, attendance, leave, reports, agent. All times in IST.
- **Why:** defined in `CLAUDE.md` by the owner.

## Pending
- Confirm Goa as the reference state for statutory rules in `RESEARCH.md` (currently Karnataka).
