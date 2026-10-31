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

## 2026-11-01 - HR assistant agent (chatbot), first slice
- **Status:** Accepted (2026-11-01, owner: "start with the HR assistant agent, like a chatbot").
- **What it is:** a chat page (`/app/assistant`) for every signed-in employee. It answers questions about their own leave, attendance, holidays and the company's leave and attendance rules, and can **prepare** a leave application for the employee to confirm. HR admins and managers also get a few summary answers (headcount and attendance counts, how many approvals are waiting).
- **How it works (ARCHITECTURE section 8):** the app server talks to the language model; the model never touches the database. It can only call a fixed list of **tools**, each a thin wrapper over an existing module function, run with the signed-in user's own permissions.
  - **Who is asking** always comes from the session. No tool accepts an employee id, and extra arguments are rejected, so a prompt cannot ask for someone else's data.
  - **Tools (v1):** my leave balances; my leave requests; my attendance this month (counts, late marks, days to fix); upcoming holidays for my location; explain a policy topic; prepare a leave application; and, for managers and HR, approvals waiting and (HR only) today's headcount and attendance counts.
  - **Counts, not names:** HR summary tools return numbers only. Names, medical or other personal details of other people are never sent to the model.
  - **Never available to the model:** Aadhaar, PAN, bank details, salary, other employees' records, roles, or anything that changes data directly.
- **The model cannot submit anything.** "Prepare a leave application" creates a **draft** that is shown to the employee with the day count, balance after and any warnings, and a **Confirm** button. Confirming runs the normal leave application with all its normal checks. A draft belongs to one person, expires after 30 minutes and can be used once.
- **Provider:** Gemini or Groq, chosen by `AGENT_PROVIDER` or by whichever key exists (`GEMINI_API_KEY`, `GROQ_API_KEY`), behind one small interface so either can be swapped by configuration. The model name is configurable (`AGENT_MODEL`); the built-in defaults were **not tested against the live services** because no key has been set. Without a key the page says the assistant is not set up.
- **Safety rules:** user text and tool results are treated as data, never as instructions; at most 4 tool rounds per message; messages over 600 characters are refused; each person is limited to 20 messages an hour and 100 a day; replies are length-capped; if the provider fails the person gets a plain apology and nothing else happens; the assistant says when it does not know and points to HR; it refuses legal or medical advice.
- **Privacy (DPDP):** questions and tool results are sent to the model provider. The page tells people not to type ID numbers, bank details or medical details. **Owner to decide and confirm before real use:** which provider and which plan, because free tiers of some providers may use inputs to improve their models, and the provider's data-handling terms and where it processes data.
- **Stored data:** conversations and messages are stored per employee, visible only to that employee, append-only (the app role cannot edit or delete them). "Clear chat" archives a conversation. **Retention target is 90 days, but nothing purges old chats yet** (the app role has no delete right by design); a purge job run with a separate privileged role is a later step.
- **Audit:** every tool call writes an audit entry with the tool name, and the messages record which tool produced each result.
- **Not in this slice:** streaming replies, voice, other languages (English only), actions other than preparing a leave application, a retrieval index over policy documents (policy text is built in from the rules in the code), a live test against the real providers, and the 90-day purge.
- **Tests:** a scripted fake provider drives the whole loop in tests (tool use, unknown tools, extra arguments, rate limits, drafts, other people's drafts, provider failure); a database test checks that conversations and drafts are scoped to their owner.

## Planned next (owner's order, 2026-11-01)
1. **Work-from-home request flow** (attendance already counts approved WFH as present, but employees cannot ask for it yet). **Remind the owner after the assistant is done.**
2. **Employee home screen** (non-HR employees currently see a placeholder at `/app`).
3. Also open: review finding 4 (half-day leave), the go-live import, the production Neon project and restricted login, and the policy-value confirmations.

## 2026-10-31 - Review fixes: app-role privileges, impossible dates, and a guard for database tests
- **Status:** Accepted (2026-10-31, owner: "fix 9, 10, 11" of the review).
- **Finding 9, privileges (migration 011):**
  - **`attendance_policy`:** the app role loses UPDATE. Nothing in the app changes the policy, and its values (grace, full-day minutes, deadline) feed payroll-relevant statuses, so a compromised app could otherwise change them without a trace. When an admin screen is built it will update the policy through an audited function and the grant comes back then, with the audit.
  - **Defence in depth:** `regularization`, `compoff_request` and `attendance_day` get the same TRUNCATE guard as the other protected tables. The app role already has no TRUNCATE privilege; this protects against someone using another role.
  - **A test that cannot be forgotten:** one privilege test now checks **every table in the database** for the app role: nothing is deleted or truncated except role assignments, the append-only tables (audit log, leave ledger, punches, attendance periods) have no UPDATE, no table has been left without access, and `schema_migration` is not reachable at all. A table added later without a grant fails this test.
- **Finding 10, impossible dates:** a date that looks right but does not exist (such as 31 February) used to reach the database and cause a server error on the Team page. A real-date check (`isRealDate`) now runs first; the data function answers with a plain message and the page falls back to today.
- **Finding 11, database tests and the wrong database:** database tests now run **only if the database host is named on purpose**: `TEST_DATABASE_HOST` must equal the host in `DATABASE_URL`, exactly like the seed guard. If tests are switched on without it (or with a different host), the run fails loudly at the start instead of touching the database. This project's Neon database is the **development** database (decision of 2026-10-30), so that is the one named in `.env.local`; production will be a different project and its host must never be named there.
- **Not changed:** finding 4 (half-day leave) and finding 8 (two helper functions without an acting user, recorded here as a known exception: `isCurrentManagerOf` and the month-lock checks in `src/shared/periods.ts` are internal helpers called only from functions that already know the acting user and have checked their role).

## 2026-10-31 - Review fixes: comp-off concurrency, one maternity per delivery, manager effective today
- **Status:** Accepted (2026-10-31, owner: "fix 5, 6, 7" of the review).
- **Finding 5, two approvals could use the same comp-off credit.** Two comp-off leave approvals for the same employee running at the same time both read the same remaining days and both used the same credit. **Fix, in two layers:** (1) deciding or cancelling comp-off leave now locks the employee's row first, as applying already does, so the second approval waits and then sees the first one's debit; (2) a database check on the ledger, so a mistake in the app cannot overspend: any ledger row that uses a comp-off credit takes a per-credit lock and must leave that credit with between 0 and its original number of days.
- **Finding 6, maternity leave could be requested over and over.** Only dates overlapping were refused. **Fix:** an employee can have **one open maternity request per delivery**: a second request whose expected delivery date is within **180 days** of a pending or approved one is refused, with a message to contact HR if it really is a different delivery. The 180 days is my assumption (about six months, safely under any two real deliveries). **Owner to confirm.** Paternity stays limited per birth date only: the system cannot check that a birth date is real, so HR must check it when approving.
- **Finding 7, "current manager" could be a future manager.** Approvals used "assignment with no end date", so a manager entered ahead of time for a future transfer could approve today. **Fix:** a person's current manager is the one on the assignment **effective today (IST)** everywhere it matters: deciding leave, comp-off and attendance fixes, the approvals lists and counts, direct reports on the profile, and the location used for earned leave accrual. The "who still reports to this person" check when deactivating deliberately still counts future assignments too, to be safe.
- **Clarifications added to RESEARCH.md as R66 to R68.**
- **Not changed:** the other open review findings (half-day leave, privileges on `attendance_policy`, date validation, test database guard, the two helper functions without an acting user).

## 2026-10-31 - Review fixes: month lock races and unpaid leave in the frozen copy
- **Status:** Accepted (2026-10-31, owner: "fix findings 2 and 3" of the review).
- **Finding 2, the lock could miss a write that was happening at the same moment.** Under normal database isolation a punch, a fix, an approval or a leave decision that committed while the lock was running could be missed by the frozen copy, or a fix could be left pending forever. **Fix:** locking a month now takes an **exclusive** per-month lock in the database for the length of the transaction, and everything that can change a month takes the **shared** form of the same lock first: punches, sending, approving and cancelling fixes, and applying for, approving or cancelling leave (including maternity and paternity). Writers wait while a lock is in progress; a lock waits for writers already running to finish, and so sees their data. After the lock commits, the existing database triggers refuse everything. Locks for different months do not block each other.
- **Finding 3, unpaid leave was frozen as plain "leave".** The frozen day now carries an `unpaid_days` amount (0 to 1) so payroll can list every unpaid day from the copy alone (migration 009). Unpaid is:
  - **absent** (no check-in, a missed check-out not fixed in time, or under 4.5 hours): 1 day;
  - **leave without pay** (the LOP leave type): 1 day for each leave day, or half a day for a half-day request;
  - **a shortfall converted to LOP** (R34): the unpaid part of the request, **taken from its last days** (paid days first, the unpaid days at the end), with a half day where the amount is a half.
  Everything else is 0, including approved paid leave, work from home, holidays and weekly offs.
- **Assumptions the owner must confirm:** (1) for a request that is partly unpaid, the unpaid days are the **last** days of the request; (2) a **half day of attendance** (4.5 to 8 hours worked) counts as 0 unpaid for now, because R27 does not say it costs half a day's pay; (3) half-day leave still counts as a complete day (review finding 4 is still open).
- **Limit:** for a partly-unpaid request that runs past the edge of the month being looked at, working days outside that month are taken as Monday to Friday with no holidays when choosing which days are unpaid. This only matters for a shortfall request that straddles two months.
- **Lock preview and result** now report the total unpaid days, which can include halves, and list people by their unpaid days.
- **Clarifications added to RESEARCH.md as R64 and R65.**
- **Not changed:** the other review findings (half-day leave, comp-off concurrency, repeated maternity requests, future-dated managers, privileges, date validation, test database guard).

## 2026-10-31 - Review fix: attendance calendar is resolved day by day
- **Status:** Accepted (2026-10-31, owner: "fix only finding 1" of the review).
- **The bug:** attendance looked up each person's location, weekly offs and policy once, for the **first day** of the period. Someone who joined on the 10th had no assignment on the 1st, so they got default weekly offs, no holidays and the default policy for the whole month; a holiday then showed as "absent, no check-in" and the month lock stored it as unpaid. A mid-month transfer used the old location for the whole month. My attendance, Team today and the month lock were all affected.
- **The fix:** weekly offs, holidays and the attendance policy are now taken **for each day** from the assignment effective on that day (ARCHITECTURE: "the row effective on the date"). A new function in the employees module returns every assignment overlapping the period (HR for everyone, anyone else only for themself). A day with no assignment, which should not happen for someone who is employed, falls back to Saturday and Sunday off, no holidays and the default policy.
- **Also changed:** the regularization deadline uses the policy of the person's location on the day being fixed, and the "late marks this month" limit shown on My attendance uses the policy effective today (or on the last day of a past month).
- **Added to RESEARCH.md as R63.**
- **Tests:** a pure lookup for "which assignment applies on this day", and database tests with a mid-month joiner (a holiday after joining must be a holiday, days before joining must not exist) and a mid-month transfer between locations with different weekly offs and holidays, checked both on screen and in the frozen month.
- **Not changed:** the other review findings (race with the lock, unpaid leave in the frozen copy, half-day leave, comp-off concurrency, repeated maternity requests, future-dated managers, privileges, date validation, test database guard) are still open.

## 2026-10-31 - Attendance: month lock
- **Status:** Accepted (2026-10-31, owner: "next: month lock"). Completes the attendance design in "Attendance module" and "regularization" (R28, P9).
- **What it does (HR admin, Attendance > Month lock):** closes a finished month. It stores a **frozen copy** of every day for everyone who worked at Konkan Coastal Foods during that month (`attendance_day`, `locked = true`) and records the lock (`attendance_period`: who, when, how many people). Payroll reads the frozen copy.
- **Unfixed days become unpaid (R28):** at lock, a day that still needs action (a missed check-out, no check-in, a short day) is stored as **absent**, with a note that it was not fixed in time. Absent without leave is unpaid.
- **When a month can be locked:** only after it has ended. Before locking, HR sees a **preview**: how many people, how many days will become unpaid, and any **fixes still waiting for approval**. Waiting fixes **block** the lock, so nobody loses a day because a manager was slow. HR can also lock before the fix deadline (the 5th), and the preview warns that employees can no longer fix those days.
- **No unlock in the app.** A locked month is final. Corrections will be made with a later adjustment (not built). This is deliberate: payroll depends on it.
- **After a lock (enforced by the database, not only by the pages):** no punch can be added for that month, no fix can be sent, approved or changed for it, and the frozen rows cannot be edited or deleted. The lock record itself cannot be changed.
- **Reading a locked month:** My attendance, Team today and the dashboard read the frozen copy, so cancelling a leave or any later change does not alter a closed month. A locked month shows a "Locked" note and offers no fixes.
- **Leave interplay (P9):** leave cannot be applied for or approved for dates in a locked month; an approved leave that overlaps a locked month can only be cancelled by an HR admin.
- **Joining and leaving dates:** days before someone joined, or after they left, are not "absent": they are outside their employment and are not stored. This also fixes the calendar for new joiners, which used to show absent days before the joining date. The lock includes people who left during the month.
- **Test data:** the seeded attendance rows for one day are replaced by the lock, because they are not locked.
- **Not in this slice:** unlocking or adjustments, a payroll export, work-from-home requests, scheduled reminders to lock, and locking by location.
- **Clarifications added to RESEARCH.md as R58 to R62.**

## 2026-10-30 - Attendance: regularization (single and bulk)
- **Status:** Accepted (2026-10-30, owner: "next: regularization"). Implements R28 and the "Days to fix" part of DESIGN 4.6 and 4.7.
- **What an employee can do:** from **My attendance**, tick one or more days that need fixing (a missed check-out, no check-in, or a short day), type the real check-in and check-out time for each, give **one reason for all of them**, and send once. Each day becomes its own request, grouped by a shared batch, so a manager can approve a whole batch together or a single day.
- **Which days:** only past working days that are flagged as needing action. Weekly offs, holidays, leave and work from home cannot be regularized, and neither can today (the day is still in progress) or the future.
- **Deadline (R28):** a day in the current month can be fixed any time. A day in the previous month can be fixed until the `regularize_until_day` of this month (5 by default, from `attendance_policy`). After that the day counts as unpaid and the employee is told to talk to HR. HR entering a fix on someone's behalf is not in this slice.
- **Approval:** same rules as leave (R20, R31): a manager approves their direct reports, an HR admin can approve anyone except themself, nobody approves their own. Rejecting needs a reason. Approving and rejecting can be done for one day or for a whole batch at once. The shared rule now lives in `src/shared/approvals.ts`.
- **What approval does:** the approved check-in and check-out times replace that day's punches when the day's status is worked out. **The raw punches are never touched** (R28). The day is then judged by the normal rules, so a fixed 09:20 to 17:45 day becomes present with no late mark.
- **Pending requests:** the day keeps its current status, shows "Fix waiting for approval" and is no longer in the "Days to fix" list. A rejected or cancelled request puts the day back in the list (until the deadline).
- **Rules in the database:** one open (pending or approved) request per employee per day; check-out later than check-in; nobody approves their own; a decided request can never be changed or deleted.
- **Not in this slice:** the month lock (the frozen copy and the "unfixed days become unpaid" step), work-from-home requests, HR entering a fix on someone's behalf, fixing late arrivals that are otherwise complete days, and an email when a request is decided.
- **Clarifications added to RESEARCH.md as R54 to R57.**

## 2026-10-31 - Leave: maternity, paternity and comp-off (R9 to R11, R24)
- **Status:** Accepted (2026-10-31, owner: "continue with the rest of leave"). Finishes the leave types left out of the first Leave slice.
- **Maternity (R9):**
  - **Entitlement:** 26 weeks if the employee has fewer than two surviving children, 12 weeks if two or more (Maternity Benefit Act, RESEARCH section 3). Counted in **calendar days**, not working days (R3 exception), and may cross a year end (exception to R33).
  - **Dates:** the employee gives the expected delivery date, the number of surviving children and the start date. The start can be at most 8 weeks before the expected delivery date and no later than that date. The end date is worked out by the system (start plus the weeks, minus a day).
  - **Who:** female employees only (gender must be recorded). There is no balance and no ledger entry; it is tracked on the request.
  - **Eligibility check:** the Act needs 80 days actually worked in the 12 months before delivery. The system cannot know that yet, so it only blocks employees with less than 80 calendar days since joining; the approver sees the tenure and checks the rest. **Owner to confirm.**
  - **Not covered:** miscarriage, medical termination, adoption or commissioning-mother leave, the work-from-home option after leave, and benefit payment (ESIC or employer). HR handles these outside the system for now.
- **Paternity (R10):** 5 **working days** per child, for male employees, within 3 months of the birth date. The employee gives the birth date, which cannot be in the future. The days can be split across requests, but not more than 5 in total per birth date. No balance or ledger entry.
- **Comp-off (R11, R24):**
  - **Earning:** after working on a weekly off or holiday, the employee requests comp-off for that date (1 day or half a day) within **30 days** (assumption, owner to confirm). The date must really be a weekly off or holiday for their location. The manager or an HR admin approves (same rules as leave, no self-approval).
  - **Credit:** approval adds a `compoff_credit` ledger entry that **expires 60 days after the approval date**. R11 says "prior approval required"; I read that as "approved before it is credited", not approval before working. **Owner to confirm.**
  - **Using it:** comp-off is a leave type like CL. Days are used **earliest-expiring first**, each debit linked to its credit (`consumes_entry_id`), and the leave dates must be on or before the expiry date of the credits used.
  - **Expiry:** unused days are unavailable from the day after they expire. An HR button writes the `expiry` entries (idempotent). Comp-off is not part of year end (R24).
  - **Approved comp-off requests cannot be cancelled** in this slice; HR corrects them with an adjustment later. If an approved comp-off leave is cancelled, the days go back only to credits that have not expired.
- **Technical:** how many days a request reserves from a balance is worked out from the leave type (maternity and paternity reserve nothing), so approve and cancel never write ledger rows for them. New columns on `leave_request`: `expected_delivery_date`, `surviving_children`, `birth_date`. New table `compoff_request`. The ledger reason list gains `compoff_credit`.
- **Clarifications added to RESEARCH.md as R47 to R53.**
- **Not in this slice:** automatic scheduled expiry, checking comp-off against actual punches, HR entering leave or comp-off on someone's behalf, and an HR adjustment screen.

## 2026-10-31 - Attendance module, first slice (punches and daily status)
- **Status:** Accepted (2026-10-31, owner: "start attendance")
- **In this slice:**
  - **Punches (migration 005):** `punch` is append-only (update, delete and truncate blocked). Employees check in and out on the web; the server records the time, never the browser. `source` allows `device` and `import` later, for biometric machines at Verna.
  - **Daily status is worked out when you look, not stored.** It is derived from punches, approved leave, holidays, weekly offs and work from home. `attendance_day` becomes a frozen copy only when HR locks a month (next slice). This avoids two copies drifting apart.
  - **My attendance** (`/app/attendance`): a check in / check out button, today's status, the month as a calendar with a status for each day, a summary, late marks counted against the monthly limit, and the days that need fixing.
  - **Team today** (`/app/attendance/team`, HR): every active employee's status for a chosen date.
  - **HR dashboard** attendance panel now shows live numbers instead of the seeded test rows.
- **Day rules (R27, in `src/modules/attendance/rules.ts`, pure and tested):** a weekly off or holiday wins; full-day leave shows as leave; half-day leave shows as a half day; approved work from home counts as present; otherwise 8 hours or more is present, 4.5 hours up to 8 is a half day, and less than 4.5 hours is absent. A check-in with no check-out on a past day is a **missed punch** (to be fixed in the next slice, R28). Today with only a check-in is provisionally present. Leave beats punches if both exist (P9).
- **Policy values are assumptions the owner must confirm:** work starts 09:30, grace 15 minutes (R26), full day 8 hours, half day 4.5 hours, 3 late marks per deduction, regularization allowed until the 5th of the next month (R28). They live in `attendance_policy`, one row per location, so changing them needs no code change.
- **Late marks are counted and shown, but no half-day deduction is applied.** R26 deducts leave automatically; the review (P8) flagged this may need legal review before it is enforced. It also needs the regularization step, because fixing a missed punch removes a late mark.
- **Not supported yet:** shifts, night shifts that cross midnight and per-shift hours (P1 is still Proposed). Everyone follows one day pattern per location; a punch belongs to the IST date it happened on. Verna uses the same defaults as Panaji until P1 is decided.
- **Cross-module access:** attendance reads people, locations, holidays and leave only through exported functions in the employees and leave modules, which check who is asking. Only HR can read everyone; anyone else can read only themself.
- **Next slices (not built):** regularization (single and bulk, with manager approval), work-from-home requests and approval, month lock with the frozen copy, the late-mark deduction (after legal review), device import, and a monthly attendance report.

## 2026-10-30 - Year-end leave processing (R22 to R25)
- **Status:** Accepted (2026-10-30, owner: "go ahead"). This closes the "must ship before 31 Dec 2026" item from the Leave decision.
- **What it does (HR admin, once a year):** for every active employee and each balance leave type (CL, SL, EL) it looks at the **available** balance (balance minus days held by pending requests). Up to the type's carry-forward cap (CL 0, SL 0, EL 45) is carried forward; anything above the cap is **encashed** if the type is encashable (EL) and otherwise **lapses** (CL and SL, which have a cap of 0, so they lapse in full).
- **Ledger entries (R25):** `lapse`, `encashment`, and a `carry_forward` pair: a debit dated 31 December of the closing year and a credit dated 1 January of the new year, so the statement shows "carried forward to 2027" and "carried forward from 2026". The pair nets to zero, so the balance is unchanged. Each entry carries a note with the reason.
- **Clarifications (added to RESEARCH.md as R38 to R41):**
  - **R38:** days held by a pending request are never lapsed or encashed; they stay reserved until the request is decided.
  - **R39:** encashment is recorded in days with the note "encash at basic pay / 30 per day"; the rupee amount is worked out by payroll, which is out of scope.
  - **R40:** year-end runs for active employees only. The settlement of a leaver's balance (R8, R15) is a separate, later feature.
  - **R41:** the run is idempotent with a unique key per employee, type and year. If a balance changes after the run (for example an approved leave is cancelled), a second run does not change it again; HR adjusts it with an adjustment entry.
- **Safety:** it can only be run from 31 December of the current year (or for an earlier year). HR first sees a **preview** (people and days per leave type, nothing written), then confirms. The preview is read-only and can be opened at any time to see what would happen today.
- **Not in this slice:** a scheduled run, the opening-balance import (P6), comp-off expiry (R24), exit settlement, and an HR screen for adjustment entries.

## 2026-10-30 - Leave module, first slice (CL, SL, EL and LOP)
- **Status:** Accepted (2026-10-30, owner: "proceed with Leave"). Works on the P4 ledger decision.
- **In scope:**
  - **Ledger (migration 004):** `leave_ledger` is append-only (update, delete and truncate blocked). Reasons in this slice: `grant`, `accrual`, `pending_hold`, `hold_release`, `application`, `cancellation`, `adjustment`. Balance is the sum of non-hold rows; **available** is balance minus open holds (P4). `expires_on` and `consumes_entry_id` exist for comp-off later.
  - **Request fields:** `lop_days` (days of a request paid as leave without pay when the balance falls short, R18), `certificate_required` (sick leave over 2 days, R7), `decision_note`, `cancelled_at`. A trigger stops any edit of an approved request except cancelling it (R21).
  - **Employee actions:** see balances, apply, cancel a pending request, cancel an approved future request, view a statement of every credit and debit.
  - **Approvals (R20, R31):** a manager decides requests from their current direct reports; an HR admin can decide any request except their own; nobody decides their own; a requester with no manager goes to HR; an HR admin's own request is decided by another HR admin or their manager. Rejection needs a reason.
  - **Credits:** an HR admin runs "Run leave credits" (idempotent). It grants CL and SL for the year (R13, never below the Goa statutory floor, P8) and accrues EL month by month (R8, R14). Every credit has a unique key, so running it twice adds nothing. A scheduled version (Vercel Cron) is a later step.
- **Clarifications made while building (added to RESEARCH.md as R33 to R37):**
  - **R33:** a request cannot span two calendar years; apply separately for each year.
  - **R34:** the shortfall converted to LOP (R18) is stored on the request as `lop_days`; LOP has no balance, so it writes no ledger row.
  - **R35:** monthly EL accrual is `1.5 x (1 - LOP working days in the month / working days in the month)`, rounded to the nearest half day. **Owner to confirm this formula.**
  - **R36:** restricted holidays are not subtracted from leave days until restricted-holiday selection exists; only national and state holidays and weekly offs are skipped (R3).
  - **R37:** "7 days" for backdating (R19) means calendar days, and a request older than that is refused with a message to contact HR, until HR can enter leave on someone's behalf.
- **Deliberately not in this slice:**
  - **Year-end processing (R22 to R25):** lapse, carry-forward and encashment. **Must ship before 31 Dec 2026.**
  - **Maternity, paternity and comp-off** (R9 to R11), the 5-working-day escalation email (R20, needs Resend), holiday administration, attendance interplay, a scheduled cron job, opening-balance import (P6), and HR entering leave on someone's behalf.
  - **Medical certificates:** only a flag and a notice, because file storage is undecided.
- **Day counting:** weekly offs and holidays come from the location on the employee's assignment effective on the request's start date (R32, simplified: a request that spans a transfer uses the start-date location).
- **Dev preview:** `/dev/leave?view=overview|apply|statement|approvals|admin` shows the screens with made-up numbers (no database, 404 in production).
- **Escalation wording:** after 5 days the approvals page says HR can also decide the request; no email is sent yet.
- **Testing:** pure rule functions in `src/modules/leave/rules.ts` (no database, shared with the browser form for the live day count) with unit tests; write functions have `...Tx` forms for rolled-back database tests.

## 2026-10-30 - People module, first slice (HR admin only)
- **Status:** Accepted (2026-10-30, owner: "start with People")
- **In scope:**
  - **People list** at `/app/people`: search by name, code or email; filter by status, location and department; 20 per page.
  - **Profile** at `/app/people/[id]`: Overview (current assignment, manager, direct reports, tenure) and History (every assignment with its effective dates, P5). Other tabs from DESIGN 4.10 (Personal, Statutory and bank, Leave, Attendance, Documents) show "Soon".
  - **Add employee:** creates the employee and their first assignment in one transaction. The code comes from the sequence and can never be changed.
  - **Change assignment** (transfer, promotion, new manager): closes the current assignment the day before the new one starts and opens a new one. Past and future effective dates are allowed; the new date must be after the current assignment's start.
  - **Deactivate / reactivate:** sets status and exit date; employees are never deleted.
- **Rules enforced on the server (and tested):**
  - Only `hr_admin` can list, view or change people; every data function checks the role itself, and actions check it again.
  - A manager must be an active employee, not the employee themself, and must not create a reporting loop (checked up the manager chain).
  - Nobody can deactivate themself, the last active HR admin, or an employee who still has active direct reports (reassign them first).
  - Work email is unique, case-insensitive; the error is shown in plain words.
  - Every create, change and deactivate/reactivate writes an audit entry in the same transaction. Audit summaries never contain sensitive data.
- **Deliberately not in this slice:**
  - **Statutory and bank data (P7):** PAN, UAN, bank, salary and the last-4 Aadhaar, because the encryption key and `employee_private` table are not set up. The tab says "Soon".
  - **Personal details:** address, phone, emergency contact and nominees have no tables yet.
  - **Sign-in invites and roles screen:** the profile only shows whether the account is linked. Sending Clerk invitations and managing roles are separate features.
  - **Manager and self views, and documents.**
- **Dev preview:** `/dev/people?view=list|profile|history|change|deactivate|new` shows the screens with made-up people. It reads no database or session and returns 404 in production.
- **Testing approach:** the write functions have a transaction-level form (`...Tx`) so database tests can run them inside a transaction that is always rolled back; nothing is left behind, since employees cannot be deleted.

## 2026-10-30 - Review fixes: development database, hardening, branch workflow
- **Status:** Accepted (2026-10-30, owner chose "fix findings first")
- **This Neon project is the DEVELOPMENT database.** It already holds 22 fake `TEST` employees and a test HR admin (codes `KCF0001` to `KCF0023`) that cannot be deleted because employee deletes are blocked by design. Production uses a **new, separate Neon project** created at go-live, where the real employees are imported with their own codes (P6, R29). Test rows never move to production.
- **Seed guard:** `db:seed` now also requires `SEED_TARGET_HOST` to equal the database host in `DATABASE_URL`, so it cannot run against a database the owner has not named on purpose. Test rows get `TST` codes, not `KCF` codes, and a loud warning is printed when `hr_admin` is granted.
- **Migration 003:** adds TRUNCATE guards on `audit_log` and `employee`, a check that a leave quota is never below its statutory floor, and a minimum-privilege role `hrms_app` (no DELETE/TRUNCATE anywhere except `employee_role`, INSERT-only on `audit_log`). The login role used by the app is created by the owner in the Neon console and granted `hrms_app`; `DATABASE_URL` is then switched to it (P3 follow-through). Until then the app still connects as the owner and the triggers are the only barrier.
- **Sign-in link (P2):** linking a Clerk user and writing its audit entry happen in one transaction. Only a unique-violation (SQLSTATE 23505) is treated as "already linked"; other database errors surface instead of showing "not linked".
- **Bootstrap exception to P3:** `findActorByClerkUserId` and `linkActorByVerifiedEmail` are the only data functions without an actor argument, because they run before an actor exists. They return only the Actor.
- **Dashboard accuracy:** pending count and oldest age now count active employees only; "on leave today" shows the true total and half days; active employees with no current assignment are counted and flagged instead of silently dropped.
- **Tests and checks:** permission and linking unit tests with the database mocked; database protection tests that run only with `RUN_DB_TESTS=yes` and always roll back; `check:boundaries` runs before every build and test and also catches dynamic `import()` and `require`. No GitHub Actions workflow yet because the current GitHub token cannot push workflow files.
- **Migration runner:** takes an advisory lock and records a checksum per applied file, failing if an applied file was edited.
- **Branch workflow:** work happens on `develop`; `main` is production on Vercel and is updated only when the owner says so.
- **Deferred (tracked):** approved leave not editable (R21), attendance lock enforcement, reporting-loop check, shifts (P1). Leave type shown to HR on the dashboard is accepted by default; the owner can ask to hide it.

## 2026-10-29 - HR dashboard redesign and dev-only design preview
- **Status:** Accepted (2026-10-29, owner asked for a "proper HRMS dashboard")
- **Decision:** the HR admin dashboard becomes a standard HR layout: greeting and date, four KPI cards (active employees, working today %, on leave today, pending approvals), a pending-leave table, an attendance stacked bar, headcount bars by location and department, who is out today, and a side column with needs-attention, upcoming holidays and new joiners. Quick actions (Add employee, Review leave, Run report) are shown disabled with a "Soon" label until those features exist.
- **Charts:** plain HTML/CSS bars using the reference palette from the data-viz skill (blue, orange, aqua, yellow, magenta in fixed order, light and dark values), with a text legend and counts so colour is never the only signal.
- **Preview route:** `/dev/hr-dashboard` renders the dashboard with made-up numbers for design review. It reads no database or session and returns 404 in production (checked with a production build).
- **Data:** the dashboard query now also returns the first five pending requests and headcount by department.

## 2026-10-29 - Database foundation first, then the HR admin dashboard
- **Status:** Accepted (2026-10-29, owner chose "real foundation first" and "HR admin first")
- **Scope of this slice:**
  - **Schema (migration 001):** `location`, `employee` (immutable employee code from a sequence, trigger blocks changes), `employment_assignment` (P5), `employee_role` (P2), `leave_type`, `leave_request`, `holiday` (with a `verified` flag), `attendance_day`, `audit_log` (append-only by trigger). Deferred to their own phases: `leave_ledger` and holds (P4), `punch`, `compoff_request`, `employee_private`, shifts (P1, still proposed).
  - **Migrations:** plain forward-only SQL in `db/migrations`, applied by `scripts/migrate.mjs`, which records applied files in a `schema_migration` table and never drops anything.
  - **Identity (P2):** `getCurrentUser()` reads the Clerk session, then loads the employee and roles from the database. An unlinked Clerk user is linked only when their verified primary email matches exactly one active employee with no Clerk link; otherwise they have no access. Roles never come from token claims.
  - **Data access (P3):** one `db` module under `src/shared`, imported only by module data-access files; a script (`npm run check:boundaries`) fails if routes, pages or components import it. Every data function takes the acting user and checks the role inside.
  - **HR dashboard:** headcount by location and status, on leave today, pending leave requests, attendance today, upcoming holidays, recent joiners. No Aadhaar, PAN, bank or salary data. Visible only to `hr_admin`; other roles see a "coming soon" message.
  - **Dates (IST):** one `dates` helper computes "today" in `Asia/Kolkata`; no code uses the server's local date.
  - **Test data:** seed script creates clearly fake employees (`TEST` names, `@example.invalid` emails) plus one HR admin whose email comes from `HR_ADMIN_EMAIL` in `.env.local`. The seed refuses to run without `ALLOW_SEED=yes`. Goa holiday rows are marked `verified = false` (tentative list, RESEARCH section 6).
- **Note:** there is only one Neon project, so test data and real data would share it. Create a separate Neon branch for development before loading real employees.

## 2026-10-29 - Landing page shows Sign in and Create account; Clerk wired in
- **Status:** Accepted (2026-10-29, owner asked: show login/signup instead of the "access by invitation" line)
- **Decision:** the landing page hero shows **Sign in** and **Create account** buttons in place of the invitation note. Clerk is wired in now (it was planned for Foundation): `/sign-in`, `/sign-up`, and a signed-in `/app` page.
- **Invite-only still applies (P2):** Clerk must be set to Restricted sign-up, so "Create account" only works with an invitation from HR. The sign-up page says so. A signed-in user with no linked employee record sees no data, only a "ask HR" message.
- **Isolation:** the landing page does not load Clerk, so it works even if Clerk keys are missing. Clerk runs only on `/sign-in`, `/sign-up` and `/app` (`proxy.ts` matcher limited to those paths).
- **Supersedes:** the "Sign in disabled / coming soon" and access-note parts of the 2026-10-29 landing-page entry.
- **Needs from owner:** Clerk Restricted sign-up turned on; the three environment variables present in Vercel before deploying this change.

## 2026-10-29 - Public landing page (new screen)
- **Status:** Accepted (2026-10-29, owner asked for it)
- **Decision:** the home page becomes a public landing page: header with logo, name and a Sign in button; a hero with a one-line purpose; four module cards (Employee Master, Attendance, Leave, HR Assistant) each marked Planned until built; a note that access is by invitation from HR; footer. No employee data and no claims about unbuilt features.
- **Sign in:** the button is shown but disabled ("coming soon") until Clerk sign-in is wired in the Foundation phase, so there is no dead link.
- **Added to:** `DESIGN.md` section 4.0.

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

## 2026-10-30: Assistant model default is gemini-3.5-flash

First live check of the Gemini provider. gemini-2.0-flash has been retired. gemini-3.8-flash answered but was
overloaded (timeouts), so the default is gemini-3.5-flash (about 5 s for a small answer; gemini-3.1-flash-lite
was about 1 s). Gemini rejects `additionalProperties` in tool schemas and needs the returned thought signature sent
back with a tool call; both are handled in `gemini.ts`. Our own strict validation still rejects unknown arguments.
Override with AGENT_MODEL. Groq is still untested live. Plan and data-handling terms are still to be decided.

## 2026-10-30: Work-from-home requests (assumptions to confirm)

The sources only say that approved work from home counts as present and needs no leave (R27) and that employees
can request it. The rest below is a **default I chose so the flow can be built; please confirm or change each one**.

- **Who may ask:** only people whose location allows it. Panaji head office: yes. Verna plant: no (shop-floor work).
  Stored per location in `attendance_policy.wfh_allowed`. Changing it is a migration for now (the app role cannot edit policy rows).
- **How many:** at most **4 days a month**, counting pending and approved days (`wfh_days_per_month`).
- **Which days:** today or up to 30 days ahead. No backdating; a past day that needs fixing goes through regularization.
  Weekly offs, holidays and days of approved leave in the chosen range are skipped. A range with no working day is refused.
- **Who decides:** the manager, or HR, never the person themselves (same rule as leave and regularization, `canDecide`).
  Requests are one row per day, grouped in a batch, so a manager can approve a whole week at once. Rejecting needs a reason.
  The approvals list shows how long each request has waited (escalation to HR after 5 working days, R20, is a later slice with the other reminders).
- **Cancel:** the person can cancel a pending request any time, and an approved one only while the day is still in the future.
- **Effect:** an approved day shows as work from home and counts as present, even with no punches (R27). A locked month is never changed:
  requests, decisions and cancellations for days in a locked month are refused (R65), and the frozen copy already stores the day.
- **Not in this slice:** emails, WFH on the HR assistant, HR filing on someone's behalf, a team calendar bar for WFH.

## 2026-10-30: Employee home screen

Follows DESIGN.md section 4.1 (greeting and today's status, balance cards, upcoming, primary actions, attention banner).

- **Where it lives:** `/app` shows the home screen to every employee who is not HR. HR keep the dashboard at `/app`, and get the same
  personal screen at `/app/me` ("My home" in the navigation), because HR staff are employees too and have their own leave and attendance.
- **Today's status:** checked in at (time), working from home, on leave, holiday, weekly off, or not checked in yet. A **Check in / Check out**
  button on the home screen uses the same server action as the attendance page (the time is always the server's).
- **Balances:** every leave type the person has, except leave without pay, with available days (balance minus held days) and a link to the statement.
- **Upcoming:** the next holidays for the person's location, approved or pending leave, and approved or pending work from home, soonest first, at most 8 items.
- **Attention:** days that need fixing with the date the window closes (also the previous month while its window is still open),
  days that can no longer be fixed and count as unpaid, and (for managers and HR) requests waiting for them.
- **Not in this slice:** team calendar, birthdays and anniversaries, announcements, and any HR numbers. The screen shows only the signed-in person's own data.

## 2026-10-30: Dashboard buttons and the first reports

- **Status:** Accepted (2026-10-30)

The three buttons on the HR dashboard were disabled placeholders ("Soon"). They now work.

- **Add employee** links to `/app/people/new`. **Review leave** links to `/app/leave/approvals`. No new rules; both pages already check the HR role on the server.
- **Run report** opens a new HR-only page, `/app/reports` ("Reports" in the navigation, HR only). ARCHITECTURE.md section 10 lists five reports; this slice builds three,
  each with an on-screen table and a **Download CSV** button:
  1. **Headcount**: every active employee with department, location, employment type and joining date.
  2. **Leave balances**: every active employee with available days (balance minus held days) for CL, SL and EL.
  3. **Attendance summary**: one month, per employee: days present, work from home, half day, on leave, absent (missed punches count as absent), weekly offs, holidays and late marks.
     Days outside a person's employment are not counted. For a locked month the numbers come from the frozen copy; for an open month they are derived, as on the attendance pages.
- **Not in this slice (still in section 10):** leave taken by period and department, and manager (team) access to reports. Reports are HR only for now.
- **CSV safety:** values are quoted and escaped; a cell starting with `=`, `+`, `-` or `@` gets a leading apostrophe so spreadsheets do not run it as a formula.
  Reports hold no Aadhaar, PAN or bank data. Every download is written to the audit log.
- **Same people in every report:** Headcount and Leave balances both list every active employee, even one with no current assignment (department, location and type are then blank).

## 2026-10-30: Owner decisions accepted

- **Status:** Accepted (2026-10-30). The owner accepted the recommended value for each open item.
- **Half-day leave (review finding 4) is now half a day of leave and half a day of attendance.** The other half of the day must be worked (at least half of the full-day
  minutes, 4 hours with the current policy). On a past day with less than that, the other half is unpaid (0.5), the day shows "Half-day leave, other half not worked"
  and can still be fixed by regularization before the deadline; once the month is locked it is frozen as half a day unpaid. Today's date and a day with an approved fix are
  never held against the person. Unpaid leave on the leave half plus an unworked other half is one whole unpaid day, never more.
  Leave balances were already right (a half-day request weighs 0.5); only attendance changed.
- **Kept as they are:** attendance policy values (09:30 start, 15-minute grace, 8 h full day, 4.5 h half day, fixes until the 5th, 3 late marks per deduction);
  half a day of attendance is paid in full; comp-off must be used within 30 days; 180 days between deliveries; the earned-leave accrual formula (R35);
  the 80-day maternity rule; the work-from-home defaults; HR-only reports with downloads audited.
- **Still to do outside the code:** HR should check one employee's earned-leave balance against the formula, confirm the 180-day gap, and confirm the 80-day rule with Goa HR.
  Real employee data must not go into the Assistant until a paid or Workspace Gemini plan (or another provider with suitable data terms) is in place.

## 2026-10-30: PAN and Aadhaar (personal details)

Implements P7 (2026-10-23, accepted). The owner chose the recommended options.

- **Who enters:** each employee adds their own PAN and the **last 4 digits** of their Aadhaar on a "Personal details" page; HR can enter or correct them on the profile
  ("Statutory" tab, which replaces the "Soon" tab). Every change writes an audit entry (no values in it).
- **Aadhaar:** only the last 4 digits and a "verified" flag (HR only can set it) are stored. The form asks for 4 digits; the full number is never typed, stored, sent or logged.
- **PAN:** format `AAAAA9999A`, stored encrypted (AES-256-GCM, key `PII_ENCRYPTION_KEY`, kept outside the database credentials, `key_version` per row for rotation).
  A keyed hash (HMAC-SHA-256, separate key derived from the same secret) is stored so the same PAN cannot be given to two employees. A pre-computed mask (`ABCDE••••F`) is stored
  so that normal reads never need the key.
- **Who sees what:** the employee sees their own masked values; HR sees everyone's masked values; nobody else sees any. Managers do not.
  The assistant, reports, dashboards and the agent tools never read this table.
- **Reveal:** HR only, one employee at a time, from the profile. The server checks the role, allows at most 10 reveals per HR user per hour, writes the audit entry **first** in the same
  transaction and refuses the reveal if the audit write fails. The value is shown once on the page response and is never put in a URL, a log or the assistant.
  An employee does not reveal their own PAN (they typed it; the mask is enough to recognise it).
- **Storage rules:** `employee_private` cannot be deleted from or truncated; the application role gets select, insert and update only.
- **Needs from owner / deployment:** `PII_ENCRYPTION_KEY` must be set in Vercel (Preview and Production) and **backed up somewhere safe**. If it is lost, stored PANs cannot be read and must be re-entered.
  Rotating the key needs a later migration job that re-encrypts rows using `key_version`.
- **Not in this slice:** UAN, bank account, IFSC and salary (same table and approach later), document uploads, and an Aadhaar verification check.

## 2026-10-31: Work locations across all of Goa

Owner: people are not only at Panaji and Verna; the add-person form must cover all of Goa. Owner chose "work location" (not a separate home-town field).

- **Locations:** one per taluka headquarters town is added next to Panaji and Verna: Mapusa, Pernem, Bicholim, Valpoi, Ponda, Vasco da Gama, Margao, Quepem, Sanguem, Canacona, Dharbandora.
  Codes are 3 letters (`MPS`, `PRN`, `BCH`, `VLP`, `PND`, `VSC`, `MRG`, `QPM`, `SNG`, `CNC`, `DHB`). Panaji (`PNJ`) and Verna (`VRN`) are unchanged.
- **Same rules everywhere:** Goa state and national holidays, and Saturday and Sunday as weekly off, are copied from Panaji to each new location (all marked "not verified" like the rest),
  so attendance, leave and reports work unchanged. Locations stay a table: HR can still ask for another town later with a new migration.
- **Not changed:** leave and attendance rules do not depend on the location other than holidays and weekly off. Copy that names only Panaji and Verna is reworded to "Goa".

## 2026-10-31: HR profile tabs (Personal, Leave, Attendance)

Owner: the "Soon" tabs on an employee's profile (Personal, Bank and salary, Leave, Attendance, Documents) must work for HR.

- **Personal** replaces the "Statutory" tab: basic details plus PAN and Aadhaar (masked, with the audited Reveal) in one place. The old `?tab=statutory` link opens it.
- **Leave** (HR only, read only): balances of CL, SL, EL and comp-off with days on hold, and that person's last 25 requests with status. Approving and cancelling stay on the approvals page.
- **Attendance** (HR only, read only): one month at a time, day by day (first in, last out, hours, status, note) with the month totals. Locked months show the frozen copy, like the attendance report.
- Each read checks the HR role on the server and does not write an audit entry (same as the other HR reads of non-private data).
- **Still "Soon", needs owner decisions:** Bank and salary (which fields, who may see salary, encryption like PAN) and Documents (where files are stored, which types, size limit, who can download).

## 2026-10-31: Bank and salary (HR only)

Owner chose to build it like PAN (decision P7 approach). Applies to the "Bank and salary" tab on an employee's profile.

- **Who:** HR only, to enter, see masked values and reveal. Employees do not see or edit it, managers never do, and the assistant, reports and dashboards never read it.
- **What is kept:** account holder name, bank name, IFSC (format `AAAA0XXXXXX`), bank account number, UAN (12 digits) and monthly gross salary in rupees.
- **Bank account number, UAN and salary** are stored encrypted (AES-256-GCM, same `PII_ENCRYPTION_KEY`, `key_version` per row). Account number and UAN keep a pre-computed mask
  (`••••••1234`, `••••••••1234`) so normal reads never need the key; the salary shows `••••••` until revealed. Account holder, bank name and IFSC are not secret on their own and are stored as text.
- **Reveal:** one value at a time, HR only. The audit entry is written first in the same transaction and the reveal fails if it cannot be written. At most 10 reveals per HR user per hour
  (counted across account, UAN and salary, separately from PAN). Shown for 30 seconds, never put in a URL or log.
- **Audit:** every save writes an entry naming the kinds of detail changed, never values. A salary change records only that the salary was changed.
- **Storage rules:** `employee_bank` cannot be deleted from or truncated; the application role gets select, insert and update only.
- **Kept simple on purpose:** one current salary figure, no salary history, no breakdown (basic, HRA, deductions) and no payslips yet. Those need their own decision when payroll is in scope.

## 2026-10-31: Dashboard tiles and rows are links

Owner: everything that looks like a button on the HR dashboard must be clickable. The four tiles, the panel headings, the "Needs attention" rows, the names in the tables and lists, and the
headcount bars now link to the page that has the detail: Active employees and the headcount bars to People (departments filter People), Working today and On leave today to the
attendance team view, Pending approvals and the leave and attention rows to Leave approvals, and a person's name to People searched by their employee code. No data changes.
