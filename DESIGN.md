# HRMS Design (UX and UI)

This document describes what the HRMS looks like and how people use it. [ARCHITECTURE.md](ARCHITECTURE.md) covers how it is built, and [RESEARCH.md](RESEARCH.md) covers the HR rules behind it (R-numbers refer to section 9 there).

**Status:** proposed. Screens are described and sketched in text; no visual mockups yet.

## 1. Design goals

1. **Explain every number.** A leave balance or attendance status always has a way to see where it came from (ledger statement, punch times).
2. **Fewest clicks for the frequent task.** Applying for leave and regularizing a missed punch happen often and must be fast, including in bulk.
3. **Show the right context.** Holidays and policy rules shown are for the person's own location and leave type, next to the field they affect.
4. **Safe with sensitive data.** IDs are masked by default; revealing one is a deliberate, logged action.
5. **Works on a phone.** Employees mostly apply, check and approve from mobile.
6. **Plain language.** No HR jargon without a short explanation ("LOP: leave without pay").

## 2. Users and what they need

| Role | Main jobs | Frequency |
|---|---|---|
| **Employee** | Apply/cancel leave, see balance and history, check holidays, view attendance, regularize punches, request WFH | Several times a week |
| **Manager** | Approve or reject team requests, see who is out, approve regularizations | Daily |
| **HR admin** | Maintain employees, leave types, holiday calendars; fix exceptions; run reports; lock months | Daily |
| **System admin** | Roles, integrations, audit review | Rare |

Pain points from the interview (RESEARCH.md section 8) that drive the design: opaque balances, one-by-one regularization, wrong-location holidays, rules hidden in PDFs, no approval notifications, a weak mobile app.

## 3. Information architecture

```
Home (role-aware dashboard)
├── Leave
│   ├── Apply for leave
│   ├── My balances  →  Statement per leave type
│   ├── My requests
│   ├── Comp-off request
│   └── Team calendar (manager/HR)
├── Attendance
│   ├── My month
│   ├── Regularize (single and bulk)
│   └── WFH requests
├── Holidays (my location, year view)
├── Approvals (manager/HR)       ← badge with pending count
├── People (HR)
│   ├── Employee list → Employee profile
│   └── Add employee
├── Admin (HR/system)
│   ├── Leave types and policy
│   ├── Holiday calendars
│   ├── Attendance policy and month lock
│   ├── Roles
│   └── Audit log
└── Profile and notifications
```

Navigation: left sidebar on desktop, bottom tab bar (Home, Leave, Attendance, Approvals, More) on mobile. Items a user has no permission for are hidden, not greyed out.

## 4. Key screens

### 4.0 Landing page (public)
The only page visible before signing in.
- **Header:** logo and "Konkan Coastal Foods HRMS" on the left; **Sign in** link on the right.
- **Hero:** heading "People operations for Konkan Coastal Foods" and one sentence: employee records, attendance and leave for the Panaji head office and the Verna plant.
- **Modules:** four cards (Employee Master, Attendance, Leave, HR Assistant), each with a short description and a **Planned** chip until built.
- **Actions:** **Sign in** (primary) and **Create account** (secondary) buttons under the hero text. Creating an account only works with an invitation from HR; the sign-up page says so, and Clerk enforces it.
- **Footer:** company name and year.
- Shows no employee data and makes no claim about features that do not exist yet. Works from 320px wide, supports light and dark, keyboard focus is visible, and there is a skip-to-content link.

### 4.1 Employee home
- Greeting and today's status (checked in, WFH, on leave, holiday).
- **Balance cards** for CL, SL, EL (and others the person is eligible for), each showing available days (balance minus days held by pending requests) and a "View statement" link.
- **Upcoming** list: next holiday for my location, approved leave, pending requests.
- Primary actions: **Apply leave**, **Regularize**.
- Banner when something needs attention, for example "3 days need regularization before the 5th".

### 4.2 Apply for leave
Single form, one screen, no wizard.

```
Leave type      [ Casual leave (CL)      v ]   Available: 5.5 days
From            [ 22 Oct 2026 ]  [ Full day v ]
To              [ 23 Oct 2026 ]  [ Full day v ]
                ───────────────────────────────
                Working days counted: 2   (Sat/Sun and holidays excluded)
                Balance after: 3.5 days
Reason          [______________________________]
Attachment      [ Add medical certificate ]   (shown when required)
                [ Cancel ]            [ Submit request ]
```

Behaviour:
- The day count updates live and lists excluded days ("24 Oct is a weekly off", "2 Oct: Gandhi Jayanti").
- A short rule line sits under the type: "CL: max 3 consecutive days" (R6). Longer rules open in a side panel, not a PDF.
- Overlap, insufficient balance and backdating limits are shown inline before submit (R17 to R19).
- If balance is short, the form offers "Use 1 day as leave without pay (LOP)" as an explicit choice (R18), never silently.
- Half-day: choose first or second half.
- Submitting reserves the days as a hold, so another request cannot use them while this one is pending. Maternity and paternity requests ask for the expected delivery or birth date and child count instead of showing a day balance.

### 4.3 Balance statement
A table of every ledger entry for a leave type: date, description (Monthly accrual, Leave applied 22-23 Oct, Lapsed at year end, Carry forward, Encashment), credit, debit, hold, expiry date where one applies, and running balance. Filter by year. A reader should be able to explain any change without asking HR (R2, R25).

### 4.4 My requests
List with status chips (Pending, Approved, Rejected, Cancelled), dates, type, days. Pending and future approved requests have a Cancel action; approved requests cannot be edited (R21). Each request shows its timeline: submitted, decided by whom, when, and the comment.

### 4.5 Holidays
Year calendar and list for the employee's own location, colour and label by type (national, state, restricted). Restricted holidays show "You have 2 of 2 left" and a Select action. A location switcher is shown only to HR.

### 4.6 Attendance: my month
Calendar grid. Each day shows a status icon and short label (Present, Half day, Absent, Leave, Holiday, Weekly off, WFH), with first-in and last-out on hover or tap. Days that need action have an amber marker: late, missed punch, absent without leave. A summary row shows days present, leave, LOP and late marks. Late marks show the running count toward the deduction rule ("2 of 3 late marks this month", R26).

### 4.6a What is built in the first Attendance slice
- **My attendance** (`/app/attendance`): a large **Check in** / **Check out** button that switches after each press, with today's first-in time and status; a month calendar showing each day's status with an icon and text label; a summary row (present, half days, leave, work from home, absent) and **late marks as "2 of 3 this month"**; and a **Days to fix** list (missed punches and short days) that points to regularization once it exists.
- **Team today** (`/app/attendance/team`, HR): pick a date and see each employee's status, first-in, last-out and a late flag, with counts at the top.

### 4.6b Regularization as built
- **Days to fix** on My attendance is a form: a checkbox per day, the check-in and check-out time for each (prefilled with the normal working hours so a missed check-out is one edit), one shared reason, and **Send for approval**. The deadline is stated under the list. Days already sent show "Fix waiting for approval".
- **Approvals** (`/app/attendance/approvals`, managers and HR): pending fixes grouped by person and batch, with **Approve all**, **Reject all** (reason required) and the same buttons per day.

### 4.6c Month lock (HR)
`/app/attendance/lock`: the year as a list of months, each **Open**, **Locked** (with who and when) or **Not finished**. Opening a finished month shows the preview (people, days that will become unpaid, fixes still waiting) and a **Lock month** button that is disabled while fixes are waiting. A locked month shows a "Locked" banner on My attendance and offers no fixes.

### 4.7 Regularization
- A list of days needing action, each with a checkbox, the problem ("Missing out-punch"), and proposed times.
- **Select several days, enter one reason, submit once** (bulk).
- Deadline shown: "Regularize by 5 Nov, after that these days become LOP" (R28).
- Month-locked days are visible but disabled with a tooltip explaining why.

### 4.8 Approvals (manager)
Inbox of pending leave, regularization and WFH items. Each row shows who, what, dates, the person's remaining balance, and who else on the team is out those days. Approve and Reject (reason required) work from the list without opening the item; bulk approve is available. Items escalate to HR after 5 working days (R20), and the row shows the countdown.

### 4.9 Team calendar
Month view with one row per team member and coloured bars for leave, WFH and holidays. Used by managers to check coverage before approving.

### 4.9a People list (HR)
Table of employees: avatar, name and code, department and designation, location, employment type, manager, and a status chip (Active / Inactive) with "Signed in" or "Not signed in". Search box (name, code, email), filters for status, location and department, and paging at 20 per page. **Add employee** button top right. Empty and no-result states say what to change. On a phone, rows become stacked cards.

### 4.9b Add employee and change assignment (HR)
One form per task, no wizard. **Add employee:** name, work email, gender, date of birth (optional), joining date, location, department, designation, employment type, manager. **Change assignment** (on the profile): effective date, location, department, designation, type, manager, with a note that history is kept. Errors appear next to the problem in plain words (for example "That manager would report to this employee"). Deactivate asks for an exit date and a confirmation.

### 4.10 Employee profile (HR)
Tabs: **Overview** (employment details, employee code shown read-only with a lock icon and tooltip "Employee codes never change"), **Personal**, **Statutory and bank**, **Leave**, **Attendance**, **Documents**, **History**.
- PAN, bank and salary appear masked. Aadhaar is never stored in full: the profile shows only the last 4 digits (`XXXX XXXX 1234`) and a verified flag. A **Reveal** button for the other fields asks for confirmation, shows the value for a short time, and writes an audit entry; the server enforces the role, rate-limits it, and refuses if the audit write fails.
- Employees are deactivated, not deleted; the profile shows status and exit date.
- The **History** tab lists each assignment (location, department, manager, grade, type) with its effective dates, so transfers and manager changes are visible.
- Inviting an employee to sign in is a button here; the profile shows invite status and whether the sign-in account is linked.

### 4.11 Admin: leave types and policy
A form per leave type: quota, accrual mode, carry-forward cap, encashment, max consecutive days, eligibility, expiry. Changing a value requires an effective-from date and shows a preview of who is affected. Statutory minimums are shown next to the field and block values below them (R4).

### 4.2a Leave pages (built in the first Leave slice)
- **My leave** (`/app/leave`): a balance card for each of Casual, Sick and Earned showing available days, with the held days (waiting on approval) in smaller text and a link to the statement; an **Apply for leave** button; and **My requests** with a status chip and a Cancel button where allowed.
- **Apply** (`/app/leave/apply`): the form from 4.2 with the live day count, the days skipped and why, the balance after, the rule line, the explicit "use the shortfall as leave without pay" choice, and a medical-certificate notice for sick leave over 2 days.
- **Statement** (`/app/leave/statement/[type]`): every credit, hold, debit and cancellation with its reason and running balance.
- **Approvals** (`/app/leave/approvals`, managers and HR): pending requests with employee, type, dates, days, how long they have waited, and Approve / Reject (reason required).
- **Admin** (`/app/leave/admin`, HR): the Run leave credits button, with a plain summary of what was added, and **Year-end processing**: choose a year, see a preview (people and days that would lapse, be encashed or carry forward, per leave type), then confirm. Confirming is only possible from 31 December.

### 4.2b Maternity, paternity and comp-off pages (built)
- **My leave** shows **Apply for maternity leave** only to female employees, **Apply for paternity leave** only to male employees, and **Request comp-off** to everyone. A Comp-off balance card appears once the employee has earned any, with the next expiry date.
- **Maternity** (`/app/leave/maternity`): expected delivery date, surviving children, start date; the page shows the entitlement (26 or 12 weeks), the end date and the total days as you type.
- **Paternity** (`/app/leave/paternity`): birth date, start and end date; the page shows the working days counted and how many of the 5 days are left for that birth date.
- **Comp-off** (`/app/leave/comp-off`): worked date, full or half day, reason; below it, my comp-off requests and my comp-off credits with their expiry dates.
- **Approvals** lists comp-off requests alongside leave requests, marked as comp-off.

### 4.12 Comp-off request
A short form: the date worked on a weekly off or holiday, and a reason. It goes to the manager; on approval a credit appears in the CL/comp-off statement with its expiry date (R11). The statement shows days left before expiry, and the home screen warns when a credit expires within 14 days.

### 4.13 Roles (HR and system admin)
List of employees with their roles. Adding or removing a role asks for confirmation and is audited. Manager status is not a role: it comes from reporting lines. The screen warns if a reporting loop would be created and when someone's approver would be themselves.

## 5. Key user flows

**Apply and approve leave**
1. Employee opens Apply, picks type and dates, sees the live count and balance.
2. Submits; a confirmation shows the request in My requests as Pending.
3. Manager gets an email and an Approvals badge; approves from the list.
4. Employee gets an email and a notification; balance and statement update; the days show as Leave in attendance.

**Fix a missed punch**
1. Employee sees amber days in My month, or the home banner.
2. Opens Regularize, ticks the days, writes one reason, submits.
3. Manager approves in bulk; statuses update and the audit trail keeps the original punches (RESEARCH.md section 7).

**Year-end**
Employees see a notice before 31 Dec: "CL and SL lapse on 31 Dec. EL above 30 days will be encashed." After the run, the statement shows lapse, carry-forward and encashment rows with reasons (R22 to R25).

## 6. Visual design

### Principles
Calm and clear: lots of white space, one accent colour, status shown with icon plus text plus colour (never colour alone).

### Colour tokens (starting palette)
| Token | Use | Value |
|---|---|---|
| `primary` | buttons, links, selected | #2F5BEA |
| `success` | approved, present | #1E8E5A |
| `warning` | pending, needs action | #B7791F |
| `danger` | rejected, absent, destructive actions | #C53030 |
| `info` | holiday, informational | #2B6CB0 |
| `neutral-900 / 600 / 200 / 50` | text, secondary text, borders, background | #1A202C / #4A5568 / #E2E8F0 / #F7FAFC |

Leave and attendance statuses each get a fixed colour and icon so the calendar can be read at a glance. Contrast for text and key UI must meet WCAG AA (4.5:1 for body text).

### Typography
System sans-serif stack (Inter if self-hosted). Base 16px, scale 12 / 14 / 16 / 20 / 24 / 32. Numerals use tabular figures in tables and statements so columns align.

### Layout and components
- 8px spacing grid; max content width 1200px; cards with 12px radius.
- Reusable components: Button (primary, secondary, danger, text), Input, Date picker (range, half-day aware), Select, Status chip, Balance card, Data table (sortable, sticky header, row actions), Calendar grid, Modal and side panel, Toast, Empty state, Skeleton loader, Confirmation dialog.
- Dates shown as `22 Oct 2026` everywhere; no ambiguous numeric formats. Weeks start on Monday by default (configurable).

## 7. States and messages

Every screen defines these states:
- **Loading:** skeletons, not spinners over blank pages.
- **Empty:** says what belongs here and offers the next action ("No requests yet. Apply for leave").
- **Error:** states what happened and what to do; field errors appear next to the field.
- **Success:** a toast plus the updated item visible on screen.

Message examples (tone: direct, no blame):
- "You have 1.5 days of CL left. You can use 0.5 day as leave without pay."
- "These dates overlap your approved leave on 23 Oct."
- "Salary is hidden. Reveal it? This action is logged."
- "Attendance for September is locked. Contact HR to make changes."

## 8. Notifications

| Event | To | Channel |
|---|---|---|
| Leave submitted | Manager | Email, in-app badge |
| Approved or rejected | Employee | Email, in-app |
| Pending more than 3 working days | Manager (reminder) | Email |
| Escalation after 5 working days | HR | Email |
| Regularization deadline in 2 days | Employee | Email |
| Year-end lapse notice | All employees | Email, in-app banner |

Employees can turn off non-essential reminders; approval outcomes always send.

## 9. Responsive behaviour

- **Mobile (under 640px):** single column, bottom tab bar, apply form as full screen, calendar shows a month list with swipe, tables turn into stacked cards.
- **Tablet and desktop:** sidebar navigation, two-column layouts for dashboard and approvals (list plus detail).
- Touch targets at least 44px; important actions (Apply, Approve) reachable by thumb on mobile.

## 10. Accessibility

- WCAG 2.1 AA target.
- Full keyboard use; visible focus ring; logical tab order; skip-to-content link.
- Form fields have labels, hints and error text tied to the control (aria attributes).
- Status is never colour-only; calendar cells include text labels for screen readers.
- Respect reduced-motion; no auto-dismissing toasts for errors.
- Dates and day counts are read out in full ("Thursday, 22 October 2026").

## 11. Content and localisation

- English first. Strings kept in resource files so Hindi and Kannada can be added later.
- Indian conventions: dates as day-month-year, currency in INR with lakh/crore grouping (`Rs 12,34,567`), IST time.
- Terms used consistently: "Leave without pay (LOP)", "Weekly off", "Regularize", "Comp-off".

## 12. Design deliverables and next steps

1. Low-fidelity wireframes for the screens in section 4 (Apply leave, Balance statement, My month, Regularize, Approvals first).
2. Clickable prototype of the two key flows and a test with 3 to 5 real users.
3. Design tokens and a small component library built in code from section 6.
4. Accessibility check on built screens (keyboard run-through, contrast, screen reader smoke test).

## 13. Open questions

- Visual identity: logo, brand colour, or a neutral default?
- Is a native mobile app needed, or is a responsive web app (installable as a PWA) enough?
- Do managers need delegation (an approver stand-in while on leave)?
- Dark mode in v1?
- Languages beyond English at launch?
