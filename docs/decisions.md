# Decision log

Record every change to a decision made in `ARCHITECTURE.md`, `DESIGN.md` or `RESEARCH.md` here **before** changing the code or those documents. Newest entries at the top.

Format: date, decision, why, what it replaces.

Status values: **Proposed** (drafted from the 2026-10-23 design review, awaiting the owner's decision), **Accepted**, **Superseded**. Proposed entries must be accepted here before `ARCHITECTURE.md`, `DESIGN.md` or `RESEARCH.md` change to match.

## Proposed (from the 2026-10-23 design review)

### P1 - Shift and weekly-off model for the Verna plant
- **Status:** Proposed
- **Problem:** R3 assumes Sat/Sun weekly offs and R26/R27 assume one punch pair per calendar day. The plant may run shifts, rotating weekly offs and night shifts that cross midnight.
- **Proposal:** add `shift` (name, start, end, crosses_midnight, grace minutes, full-day and half-day hours) and `shift_assignment` (employee, shift, weekly-off pattern, effective_from, effective_to). Attendance is derived per *shift day*: a night shift belongs to the date it started on. Thresholds in R26/R27 become per-shift values. Head-office staff use a default General shift with Sat/Sun off.
- **Alternatives:** keep one global pattern and treat the plant as out of scope for v1 (cheapest now, but plant staff would need a separate process).
- **Needs from owner:** how the plant actually works (shifts, offs, overtime, who is a "worker" under the Factories Act).
- **Affects:** R3, R26, R27, `attendance_day`, `employee`, DESIGN 4.6.

### P8 - Statutory basis and plant coverage (blocked on research)
- **Status:** Proposed, blocked
- **Open points:** which Goa Act applies and from when; whether the Verna plant is covered by the Factories Act; whether the 9th paid holiday exists beyond the 8 listed; whether statutory sick and casual leave may be pro-rated for mid-year joiners; whether R26 (auto-deduct for late marks) is lawful. Until resolved, R13 must not reduce SL or CL below the statutory minimum for any employee, and leave rules stay configurable per leave type.
- **Action:** check the official gazette and take advice from a labour-law professional; record the answers here.

### P9 - Smaller rule gaps to settle in RESEARCH.md
- **Status:** Proposed
- Use one cut-off: regularization deadline is the day before the month lock, and the lock date is a stored value per month (`attendance_period`, with who locked it and when).
- Define "days" as working days in R19 and R20, resolved against the employee's holiday calendar.
- If approved leave overlaps a day with punches, leave wins and HR is notified; cancelling leave in a locked month needs HR approval.
- Say which employment types get which leave (contract, intern, trainee).
- Add the fields the screens need: personal and family details, documents, notifications and preferences, restricted-holiday selections, leave eligibility (tenure), WFH policy, and add the missing screens (check-in and check-out, HR assistant, reports) to DESIGN.md.

## Accepted

## 2026-10-23 - Database is Neon (Postgres), not Supabase
- **Status:** Accepted (2026-10-23, owner)
- **Decision:** use Neon for PostgreSQL. Supabase is dropped. The app connects only from server code with a Neon connection string (pooled) using a restricted application role, not the database owner.
- **Consequences:**
  - **Region:** Neon has no Mumbai region. The closest is Singapore (`aws-ap-southeast-1`), and a project's region cannot be changed later. Proposed: create the Neon project in Singapore and pin Vercel functions to `sin1` so the app and database are close. Data therefore sits outside India; confirm this is acceptable under the DPDP Act and company policy before real employee data goes in. Until then use only test data.
  - **File storage:** Neon has no storage service, so medical certificates and documents need another home. Proposed: a private S3 bucket in Mumbai (`ap-south-1`) with short-lived signed URLs. Not decided; leave attachments are not built until it is.
  - **Transactions and locks:** use the pooled connection with the `@neondatabase/serverless` pool driver, which supports interactive transactions (`SELECT ... FOR UPDATE`).
  - **Access control (affects P3):** the "service key bypasses RLS" risk becomes "the connection role can read everything". Use a non-owner application role with minimal privileges, UPDATE and DELETE revoked on ledger and audit tables, and RLS as a second barrier. The data-access layer rule in P3 stands unchanged.
  - **Migrations:** plain forward-only SQL files in `db/migrations` (tool to be chosen, for example dbmate). `supabase/` folder is removed from the planned layout.
  - **Environments:** use Neon branches for development and staging, with production on its own branch or project. Never reset or restore a shared branch without asking.
  - **Backups:** Neon point-in-time restore window depends on the plan; check it before go-live.
- **Replaces:** Supabase Postgres and Storage in the 2026-10-21 stack decision.
- **Updated:** `CLAUDE.md`, `ARCHITECTURE.md`, `.env.example`, `vercel.json`, `README.md`, dependencies.

## 2026-10-23 - P2 - Identity linking and roles
- **Status:** Accepted (2026-10-23)
- **Problem:** roles live in Clerk metadata and in `employee.role`; linking by email can be spoofed; one role per person; stale sessions keep removed access; no rule against self-approval.
- **Proposal:**
  - Clerk sign-up is invite-only. HR creates the employee row, then sends a Clerk invitation; the Clerk user is linked by `clerk_user_id` after a verified email match. Unlinked Clerk users get no access.
  - **The database is the single source of truth for roles.** Clerk holds identity only. Every request loads the current employee row and roles from the database; no role claim in the token is trusted.
  - Replace `employee.role` with `role` and `employee_role` (an employee can be manager and HR). "Manager" is derived from `manager_id` relationships, not granted manually. Reporting scope for managers and reports is direct reports only in v1.
  - Approval rules: no one approves their own request; a request from someone with no manager, or whose manager is the requester, goes to HR; HR's own requests go to a designated second approver; no circular reporting lines (checked on save).
  - Deactivating an employee blocks access at once because the database is checked every request.
- **Affects:** ARCHITECTURE sections 5, 6, 9; DESIGN 4.11; new admin screen for roles.

## 2026-10-23 - P3 - One enforced data-access layer
- **Status:** Accepted (2026-10-23)
- **Problem:** server code uses a privileged database credential (originally the Supabase service key), which bypasses RLS, so one missing check leaks data.
- **Proposal:** all database access goes through a data-access layer in each module that requires an `actor` argument and applies scoping inside the query. Route handlers, server actions and server components never import the database client directly (enforced by a lint rule and a CI check). Each new endpoint ships with a permission test. Keep RLS enabled with no public policies as a second barrier, and consider a restricted database role per module later.
- **Affects:** ARCHITECTURE section 6 (decisions 2 and 3), CLAUDE.md rules, testing strategy.

## 2026-10-23 - P4 - Leave ledger structure
- **Status:** Accepted (2026-10-23)
- **Problem:** the ledger has no lots or expiry (comp-off, R11/R24), no leave-year dimension, no reservation for pending requests, and maternity does not fit a day balance.
- **Proposal:**
  - Ledger columns: `leave_year`, `delta` as `numeric(5,1)` in half-day steps, `expires_on` on credits that expire, and `consumes_entry_id` on debits so expiring credits are consumed first-expiry-first (FIFO).
  - Pending requests create a `hold` row (reason `pending_hold`) that reduces available balance; approval converts it to a debit, rejection or cancellation releases it. This closes the double-submit gap.
  - Maternity and paternity are tracked as `leave_request` entitlements with their own fields (expected delivery date, child count, eligibility checks), not as a balance. They write calendar-day usage for reporting only.
  - Make comp-off a first-class flow: `compoff_request` (worked date, reason, status), credited to the ledger on approval with `expires_on`.
  - The ledger is protected at database level: UPDATE and DELETE revoked, correcting rows only.
- **Affects:** R2, R9, R10, R11, R18, R24, R25, ARCHITECTURE section 5, DESIGN 4.2 and 4.3.

## 2026-10-23 - P5 - Effective-dated employment history
- **Status:** Accepted (2026-10-23)
- **Problem:** location, manager, department and role are single current values, so a transfer rewrites history.
- **Proposal:** add `employment_assignment` (employee, location, department, manager, grade, employment type, effective_from, effective_to). The current values on `employee` become a view or cache of the open row. Holidays, weekly offs, approvals and reports resolve the assignment effective on the date in question. The History tab in DESIGN 4.10 reads from this table.
- **Affects:** ARCHITECTURE section 5, R3, holiday and attendance derivation, DESIGN 4.10.

## 2026-10-23 - P6 - Go-live import: opening balances and existing employee codes
- **Status:** Accepted (2026-10-23)
- **Problem:** the 180 employees already have codes and balances, but the design generates new codes and starts balances at zero.
- **Proposal:** keep existing codes as issued (stored as given, unique and immutable from import onward) and have the sequence continue after the highest numeric code, with the format agreed in advance. Add a one-time, audited import for opening balances: ledger rows with reason `opening_balance`, dated at cut-over, from a reviewed file. Run in staging first with HR reconciliation before production.
- **Needs from owner:** the current code format, the cut-over date, and the source of current balances.
- **Affects:** ARCHITECTURE sections 5 and 14, R1, R2.

## 2026-10-23 - P7 - Aadhaar and other sensitive identifiers
- **Status:** Accepted (2026-10-23)
- **Problem:** storing full Aadhaar numbers is restricted and high-risk; encrypted columns cannot be searched or de-duplicated; key and service key sit together.
- **Proposal:** do not store the full Aadhaar number. Store only the last 4 digits plus a verified/not-verified flag unless the owner confirms a lawful need. PAN, UAN and bank fields are encrypted at application level with a **separate** encryption key kept outside the database credentials, with a key version on each row for rotation, and a keyed hash (blind index) of PAN for de-duplication. Reveal is enforced on the server, rate limited and audited, and fails if the audit write fails.
- **Needs from owner:** confirmation that no process needs the full Aadhaar number.
- **Affects:** RESEARCH section 1, ARCHITECTURE sections 5 and 9, DESIGN 4.10.

## 2026-10-21 - Goa is the reference state for statutory rules
- **Decision:** `RESEARCH.md` uses Goa's Shops and Establishments law (9 sick, 6 casual, 15 earned days as statutory minimums) and Goa's holiday calendar. Company policy keeps CL 8 and EL 18, and SL is set to the statutory 9 (R6 to R8, R23).
- **Why:** the company is in Goa.
- **Replaces:** Karnataka as the reference state.

## 2026-10-21 - Stack changed to Next.js, Supabase, Clerk, Resend, Gemini/Groq
- **Decision:** Next.js on Vercel (single app), Supabase Postgres and Storage, Clerk for auth, Resend for email, Vercel Cron for jobs, Gemini or Groq for the HR assistant agent.
- **Why:** managed services suit a 180-person company and a small team; one deployable app.
- **Replaces:** the first draft in `ARCHITECTURE.md` (React + NestJS + Prisma + Redis/BullMQ + self-managed JWT auth).

## 2026-10-21 - Project scope and modules
- **Decision:** Konkan Coastal Foods HRMS for 180 employees (Panaji head office, Verna plant). Modules: employees, attendance, leave, reports, agent. All times in IST.
- **Why:** defined in `CLAUDE.md` by the owner.

## Pending
- Owner inputs for P6: current employee code format, cut-over date, and source of current balances.
- Owner confirmation for P7 that no process needs the full Aadhaar number.
- Confirm which Goa Act applies (1973 or 2025) and its commencement date.
- Replace the tentative 2026 holiday list with the official Goa notification.
- Check Factories Act applicability for the Verna plant.
