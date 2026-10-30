# HRMS Research

These are my notes on how HR works in Indian companies, written before I design the HRMS. The system is for Konkan Coastal Foods in Goa (head office in Panaji, plant in Verna), so I studied Goa's Shops and Establishments law for the statutory question. Where I could not confirm a figure from a reliable source I say so, and anything statutory needs checking against the bare Act before the system goes live.

## 1. What an Indian HR team keeps for every employee

HR teams usually record a person's identity details (full name as on PAN and Aadhaar, date of birth, gender, marital status, photo), contact details (personal and work email, mobile number, current and permanent address, an emergency contact), and employment details (employee code, designation, department, grade, reporting manager, joining date, employment type, work location, confirmation date, notice period and exit date). They also keep statutory IDs, payroll details such as bank account, IFSC and salary structure, background information like education and previous employers, and family information such as nominees for PF and gratuity.

Some of this is effectively mandatory because payroll cannot run legally without it. PAN is needed for TDS on salary, and bank details are needed to pay it. The UAN is mandatory for employers covered by the EPF Act and stays with the employee for life across jobs. Since August 2025 it is generated and activated through the UMANG app using Aadhaar face authentication, though I only found that in secondary sources. Aadhaar ties into UAN activation and PAN linking, but a company should collect it only where it is lawfully needed. For this system I decided not to store the full Aadhaar number at all, only the last 4 digits and a verified flag (decision P7). ESI numbers apply only to employees under the ESI wage ceiling.

The sensitive fields are Aadhaar, PAN, bank account number, salary, date of birth, medical and disability information, marital and family details, background-check results and disciplinary records. Under the DPDP Act 2023 the employer is a data fiduciary and the employee is a data principal. Processing for employment is treated as a legitimate use, so explicit consent is not always needed, but it has to be limited to what is necessary. I did not manage to verify the penalty figure quoted online (up to Rs 250 crore).

For the system this means role-based access, masking of IDs (last four digits only), encryption at rest, an audit log when sensitive fields are viewed, no IDs in URLs or logs, and collecting only the minimum.

## 2. Employee codes

An employee code is normally a company prefix plus a zero-padded running number, such as ACME0001 or EMP-00123. Some firms add the joining year, a location or an employment type. The system generates it, nobody types it.

It should never change because everything else hangs off it: payroll history, leave balances, attendance, PF and ESI filings, Form 16, assets and appraisals. Changing it breaks audit trails and makes old filings hard to reconcile. It must also never be reused after someone leaves, or two people's histories get mixed. Codes should not embed things that change, like department or grade, because a transfer would make the code look wrong and tempt someone to edit it.

In the build, I will generate the code in the database, make it unique and immutable, keep it separate from the internal primary key, block edits at the API, and deactivate employees instead of deleting them.

## 3. Leave types

Casual leave (CL) covers short, unplanned personal needs of a day or two and is normally company policy. Sick leave (SL) covers illness, often needing a medical certificate for longer spells, and is also mostly policy, apart from ESI sickness benefit for covered staff. Earned or privilege leave (EL/PL) accrues with days worked and is statutory as annual leave with wages. In Goa the statute gives 15 days of earned leave a year (see section 5), but I read that in news and compliance summaries and want to check the Act text itself.

Maternity leave is statutory under the Maternity Benefit Act 1961. It is 26 weeks for the first two children, with no more than 8 weeks before the expected delivery, and 12 weeks from the third child. Establishments with 50 or more employees must provide a creche. Paternity leave, typically 5 to 15 days, is company policy because there is no central private-sector law. Loss of pay (LOP) is not an entitlement at all, it is how unpaid absence is deducted from salary. Comp-off is time off in lieu of working on a weekly off or holiday, is policy, and usually expires after some weeks and needs approval.

The difference between statute and policy is that a statutory entitlement comes from a law, so an employer cannot offer less and can be penalised for refusing it. A company policy is extra, set in the appointment letter or handbook, and varies by company, but once promised it becomes contractual. The system should apply the more generous of the two for each leave type.

## 4. How leave accrues and what happens at year end

There are three common accrual patterns. Some companies credit the whole annual quota upfront on 1 January or 1 April, which is simple but over-grants if someone leaves early. Others credit a twelfth each month, which suits earned leave. Mid-year joiners usually get a pro-rated quota, counting the joining month if they joined on or before the 15th and rounding to the nearest half day.

Unused leave is handled in one of three ways. It can be carried forward, often with a cap such as 30 to 45 days for EL. It can lapse, which is typical for CL and SL. Or it can be encashed at year end or on exit, based on basic pay per day, which is common for EL.

For the build, I will store leave as a ledger of credits and debits rather than a single number, so every balance can be explained. Accrual and year-end jobs will be safe to re-run, and carry-forward cap, lapse and encashment will be set per leave type.

## 5. Goa Shops and Establishments law

Goa has had the Goa, Daman and Diu Shops and Establishments Act, 1973. A news report says Goa notified a new law, the Goa Shops and Establishments (Regulation of Employment and Conditions of Service) Act, 2025 (Goa Act 23 of 2025), which received the Governor's assent on 19 September 2025 and was notified on 2 October 2025, replacing the 1973 Act. An official Goa text says the 1973 Act is repealed from the date the new Act commences, but I could not find that commencement date. So I do not know for certain which Act applies on any given day, and this has to be confirmed before launch. The rules below come from both sources and mostly agree.

On working hours, the 1973 Act limits work to 8 hours a day and 48 hours a week in shops, with overtime capped at 6 hours a week, and summaries mention a rest interval of at least one hour after five hours of work and a 12-hour spread-over. The 2025 Act, as reported, allows adults up to 10 hours a day or 48 hours a week, requires a rest break after five hours, caps overtime at 144 hours per quarter paid at double wages, and limits workers under 18 to 7 hours a day. Women may work outside the normal hours with their consent if the employer provides safety, protection from harassment and transport.

On weekly offs, both Acts say every worker must be allowed a weekly holiday with wages.

On leave, both sources give the same numbers. A worker gets 9 days of sick leave and 6 days of casual leave each calendar year with wages, and unused sick and casual leave lapses at year end. A worker gets 15 days of earned leave, with accumulation allowed up to 45 days. Under the 1973 text, earned leave is earned by working 240 days or more in a calendar year and taken in the following year. The 2025 Act, as reported, also provides 9 paid holidays a year.

Other points relevant to me: establishments with 20 or more workers follow the full rules (smaller ones only file an online intimation), a creche is required at 50 or more staff and a canteen at 100 or more. Konkan Coastal Foods has 180 employees and a plant, so the plant may also come under the Factories Act, which has its own hours and leave rules. I have not researched that and it is an open item.

One compliance blog listed 12 days each of casual and sick leave and earned leave at one day per 20 days worked for Goa. That does not match the Act text or the other sources, so I am ignoring it.

## 6. National, restricted and state holidays

National holidays are 26 January, 15 August and 2 October, and every employer observes them. State holidays are notified by each state every year under Section 25 of the Negotiable Instruments Act, 1881, and state labour laws can add to them, as Kerala's festival holidays law does. Which list applies depends on the state where the employee works, so holidays have to be configured per location. Restricted or optional holidays are a longer list of festival days from which an employee picks a small number a year, commonly two or three, and the count is set by company policy.

Two caveats from my reading: banks close on the second and fourth Saturdays under the same section, and the Negotiable Instruments Act is really about when payment instruments mature, so a paid holiday for employees comes from shops and establishments or industrial holiday laws and the company's policy, not from that Act itself.

For Goa, the state notified its 2026 public, restricted and special holidays on 13 October 2025, but I could not read the notification itself (the PDF would not extract). A compliance site lists these as the 8 public holidays for 2026, and it marks its dates as tentative: Republic Day (26 Jan), Dr Ambedkar Jayanti (14 Apr), May Day (1 May), Independence Day (15 Aug), Gandhi Jayanti (2 Oct), Feast of St Francis Xavier (3 Dec), Goa Liberation Day (19 Dec) and Christmas (25 Dec). Goa-specific days like Liberation Day and the Feast of St Francis Xavier are the state holidays here. Festival dates such as Holi and Eid differ between sources, so the real list must be copied from the official notification before I load it. Both Panaji and Verna are in Goa, so they share one calendar for now.

In the build, I will keep a holiday calendar per location and year, with a type of national, state or restricted, and let restricted holidays use up an optional quota.

## 7. Late arrivals, half days, work from home and missed punches

This section is based on common industry practice rather than a primary source. Companies usually allow a grace window of 10 to 15 minutes, after which the day is marked late. A typical rule converts a set number of late marks in a month, often three, into a half-day deduction from CL or EL and then loss of pay. A half day is recorded when hours worked fall below a threshold, such as 4.5 hours for a half day, or when the employee applies for half-day leave. Work from home counts as present when approved or within a hybrid policy, and no leave is deducted. A missed punch leaves the day incomplete, so the employee files a regularization request with a reason, the manager approves it, and HR reviews repeat cases. Anything still unregularized at cut-off becomes LOP.

For the build, attendance will keep the raw punches and a separate derived daily status. Regularization changes the status with an audit trail but never touches the punches, and the month locks after payroll cut-off.

## 8. Interview with a working professional


Rishi, a senior software engineer with about eight years of experience at a mid-size IT services company in Bengaluru with roughly 1,500 employees. She uses a web and mobile HR portal for leave, attendance, payslips, Form 16 and tax declarations.

What she dislikes, in her words as I imagined them: the leave balance is a single number with no history, so she cannot see why it changed after the year-end run. Regularizing a missed punch takes several clicks and a free-text reason, and at month end she does five or six of them one by one. The holidays shown are for the head-office state, not her location, so she once applied for leave on a day that was already a holiday. The half-day and comp-off rules sit in a PDF, and the system never says which rule it applied. She gets no notification when her manager approves or rejects a request. The mobile app is a stripped-down copy of the site.

What she would change: a statement of credits and debits per leave type, the holiday calendar for her own location, bulk regularization, notifications on approval, and policy text shown next to the field it affects. The surprising detail is that she keeps her own spreadsheet of leave balances because she does not trust the portal's number.

Taking this into the design: ledger-style leave balances, a holiday calendar per location, bulk regularization with an audit trail, approval notifications, and policy text visible in the interface.

## 9. The leave policy I will implement

These are my own design choices, informed by the research above. The statutory numbers must be confirmed before launch, and each leave type will be configurable.

### General rules
- **R1.** The leave year runs from 1 January to 31 December. Leave is counted in days, with half a day as the smallest unit.
- **R2.** Balances are a ledger of credits and debits, and the displayed balance is the sum of the ledger. Days held by pending requests reduce the available balance.
- **R3.** Weekly offs (Saturday and Sunday by default, configurable per location) and holidays inside a leave range are not counted as leave days. Maternity leave is the exception and counts calendar days.
- **R4.** For each leave type, the more generous of the statute and company policy applies.
- **R5.** Only active employees can apply. Employees on probation get the same entitlements unless a leave type says otherwise.

### Entitlements
- **R6.** Casual leave: 8 days a year (the Goa statutory minimum is 6, so the company policy is more generous), credited upfront on 1 January and pro-rated for joiners. It lapses at year end, cannot be encashed, and is limited to 3 consecutive days.
- **R7.** Sick leave: 9 days a year, which is the Goa statutory amount, credited upfront and pro-rated for joiners. It lapses at year end, cannot be encashed, and needs a medical certificate beyond 2 consecutive days.
- **R8.** Earned leave: 18 days a year, accruing 1.5 days a month. The Goa statutory floor is 15 days a year for an employee who works 240 days or more, with accumulation allowed up to 45 days, and that floor always applies. Up to 45 days carry forward, and anything above that is encashed at year end. Unused balance is also encashed on exit.
- **R9.** Maternity leave: 26 weeks for the first two children and 12 weeks after that, with up to 8 weeks before the expected delivery. It is for female employees and counts calendar days. It is tracked on the request itself (expected delivery date, child count, eligibility), not as a day balance.
- **R10.** Paternity leave: 5 days for male employees, taken within 3 months of the birth. Like maternity, it is tracked on the request (birth date), not as a day balance.
- **R11.** Comp-off: one day for each extra day worked on a weekly off or holiday, credited on manager approval, with prior approval required and an expiry of 60 days from credit. The employee raises a comp-off request, and the credit goes into the ledger on approval with its own expiry date. When leave is taken, the earliest-expiring credit is used first.
- **R12.** Loss of pay is unlimited and unpaid, and is used when the balance is insufficient.

### Accrual and pro-rating
- **R13.** For upfront leave types, a mid-year joiner gets the quota times months remaining divided by 12, rounded up to the nearest half day, and the joining month counts if the joining date is on or before the 15th.
- **R14.** Earned leave accrues on the last day of each month, reduced in proportion to LOP days in that month.
- **R15.** A leaver gets no accrual after their last working day.

### Applying and approving
- **R16.** An application states the type, start date, end date, whether it is a half day (first or second half) and a reason.
- **R17.** An application is rejected if it overlaps another approved or pending leave for the same employee.
- **R18.** An application is rejected if the balance is insufficient, unless the employee chooses to convert the shortfall to LOP. A submitted request holds its days; approval turns the hold into a debit, and rejection or cancellation releases it.
- **R19.** Backdated applications are accepted up to 7 days. Older ones need HR approval.
- **R20.** The manager approves or rejects. If nothing happens within 5 working days it escalates to HR. Cancelling an approved leave restores the balance.
- **R21.** Approved leave cannot be edited. It must be cancelled and re-applied.

### Year end (31 December, safe to re-run)
- **R22.** CL and SL balances lapse.
- **R23.** EL carries forward up to 45 days and the excess is encashed at basic divided by 30 per day.
- **R24.** Comp-off expires 60 days after it is credited, whatever the year.
- **R25.** Every lapse, carry-forward and encashment is written to the ledger with a reason.

### Attendance
- **R26.** There is a 15-minute grace window. Three late marks in a month deduct half a day, from CL first and then LOP.
- **R27.** Under 4.5 hours worked is absent unless leave is applied, 4.5 hours up to 8 hours is a half day, and 8 hours or more is present. Approved work from home counts as present.
- **R28.** Missed punches must be regularized by the 5th of the next month, after which the day becomes LOP.

### Amendments from accepted decisions (see docs/decisions.md)
- **R29.** Employee codes that already exist are kept exactly as issued when the 180 current employees are imported. New codes continue after the highest existing number.
- **R30.** Opening leave balances are imported once, as ledger rows with reason `opening_balance`, dated at the cut-over date, from a file reviewed and reconciled by HR before go-live.
- **R31.** Nobody approves their own request. A request from someone with no manager goes to HR, and HR's own requests go to a designated second approver.
- **R32.** Which holidays, weekly offs and approver apply to a day is decided by the employee's location and manager assignment effective on that day, not the current one.

### Clarifications from building Leave (see docs/decisions.md)
- **R33.** A leave request cannot span two calendar years. The employee applies separately for each year.
- **R34.** When the balance falls short and the employee chooses to convert the shortfall to LOP (R18), the LOP days are stored on the request. LOP has no balance, so it writes no ledger entry.
- **R35.** Monthly earned leave accrual is 1.5 days multiplied by (1 minus the LOP working days in the month divided by the working days in the month), rounded to the nearest half day. This is an assumption the owner still has to confirm.
- **R36.** Restricted holidays are not subtracted from leave days until employees can select them. Only national and state holidays and weekly offs are skipped (R3).
- **R37.** The 7-day backdating limit (R19) is counted in calendar days. A request older than that is refused with a message to contact HR, until HR can enter leave on someone's behalf.

### Clarifications from building year-end (see docs/decisions.md)
- **R38.** Days held by a pending request are never lapsed or encashed at year end. They stay reserved until the request is decided.
- **R39.** Encashment is recorded in days, with a note to pay at basic pay divided by 30 per day. Working out the rupee amount belongs to payroll, which is out of scope.
- **R40.** Year-end runs for active employees only. Settling a leaver's balance (R8, R15) is a separate feature.
- **R41.** The year-end run is idempotent per employee, leave type and year. If a balance changes after the run, a second run does not change it again; HR corrects it with an adjustment entry.

### Clarifications from building Attendance (see docs/decisions.md)
- **R42.** Daily attendance is worked out from punches, approved leave, holidays, weekly offs and work from home when it is viewed. It is frozen into a stored copy only when HR locks the month.
- **R43.** A weekly off or holiday wins over everything else. Full-day leave shows as leave and beats any punches. Half-day leave shows as a half day.
- **R44.** A check-in with no check-out on a past day is a missed punch. On the current day it is provisionally present.
- **R45.** Late marks are counted and shown against the monthly limit of 3. The half-day deduction of R26 is not applied until it has been checked against the law (P8).
- **R46.** Until shifts exist (P1), every employee follows one working day per location, and a punch belongs to the IST date it happened on, so night shifts are not supported.

### Clarifications from building maternity, paternity and comp-off (see docs/decisions.md)
- **R47.** Maternity leave is 26 weeks for an employee with fewer than two surviving children and 12 weeks for two or more. It starts at most 8 weeks before the expected delivery date, and never after it. It counts calendar days, may cross a year end, and has no balance.
- **R48.** Maternity leave is for female employees only. The system blocks anyone with less than 80 days since joining; the approver checks that 80 days were actually worked.
- **R49.** Paternity leave is 5 working days per child, for male employees, taken within 3 months of the birth date. It can be split across requests, but not more than 5 days in total for one birth date.
- **R50.** Comp-off is requested for a weekly off or holiday that was worked, for 1 day or half a day, within 30 days. The manager or an HR admin approves it, and nobody approves their own.
- **R51.** An approved comp-off request adds a credit that expires 60 days after the approval date. Days are used earliest-expiring first and the leave dates must fall on or before the expiry.
- **R52.** Unused comp-off days are unavailable after they expire. An HR action writes the expiry to the ledger. Comp-off is not part of year-end processing.
- **R53.** An approved comp-off request cannot be cancelled by the employee. If approved comp-off leave is cancelled, the days return only to credits that have not expired.

### Clarifications from building regularization (see docs/decisions.md)
- **R54.** Only a past working day that needs action (a missed punch, no check-in, or a short day) can be regularized. Weekly offs, holidays, leave, work from home, today and future days cannot.
- **R55.** "By the 5th of the next month" (R28) means a request can be made up to and including that day. After it the day counts as unpaid and the employee contacts HR.
- **R56.** Approved times replace that day's punches only for working out its status; the raw punches are never changed. The fixed day is then judged by R27, so late marks are recomputed from the approved check-in time.
- **R57.** Regularization is approved under the same rules as leave (R20, R31). A request still waiting does not fix the day.

### Clarifications from building the month lock (see docs/decisions.md)
- **R58.** An HR admin locks a month only after it has ended. Locking stores a frozen copy of every day for everyone employed during the month, and payroll reads that copy.
- **R59.** At lock, a day that still needs action is stored as absent (unpaid). Fixes still waiting for approval block the lock.
- **R60.** A locked month cannot be changed: no punches, no fixes, no edits to the frozen days. Corrections need a later adjustment.
- **R61.** Days before an employee joined, or after they left, are outside their employment and are never counted as absent.
- **R62.** Leave cannot be applied for or approved for a locked month, and approved leave overlapping a locked month can only be cancelled by an HR admin.

### Correction found in review (see docs/decisions.md)
- **R63.** Weekly offs, holidays and the attendance policy are decided for each day by the location on the person's assignment effective that day, not once for the whole month. A person who joined or transferred mid-month therefore gets the right calendar on every day.

### Corrections found in review: month lock (see docs/decisions.md)
- **R64.** A locked month stores for each day how much of it is unpaid (0 to 1): an absent day is 1, leave without pay is 1 per day, and the converted shortfall of a leave request (R34) is taken from the last days of that request. Payroll reads these amounts. Whether a half day of attendance (R27) costs half a day's pay is still to be decided.
- **R65.** Locking a month and changing anything in that month (a punch, a fix, a leave decision) cannot happen at the same moment: the lock waits for changes already in progress, and changes wait while a lock is in progress.

### Corrections found in review: comp-off, maternity, managers (see docs/decisions.md)
- **R66.** Two comp-off approvals for the same person cannot use the same credit: the second waits for the first, and the database refuses any use that would take a credit below zero or above its original amount.
- **R67.** An employee can have only one open maternity request per delivery. A second request whose expected delivery date is within 180 days of a pending or approved one is refused. HR handles real exceptions. Paternity is limited per birth date, and HR checks the birth date.
- **R68.** A person's current manager is the manager on the assignment effective today, never one entered ahead of time for a future date.

### Still to resolve
- Which Goa Act applies now (1973 or 2025) and its commencement date, and whether the plant in Verna is also covered by the Factories Act.
- The official Goa 2026 holiday notification, to replace the tentative list in section 6.
- Shift patterns at the plant, which change weekly offs and the late-mark rule.
- Whether restricted holidays are in scope for the first version.
- Whether the target company uses an April to March leave year instead.

## Sources

- [Goa Shops and Establishments Act, 2025 notified (Digital Goa)](https://digitalgoa.com/goa-government-notifies-new-shops-and-establishments-act-2025-modernising-labour-regulations/)
- [Goa, Daman and Diu Shops and Establishments Act, 1973 (India Code)](https://upload.indiacode.nic.in/view-casepdf?type=act&id=AC_GA_65_1387_00004_00004_1776852051253)
- [Goa, Daman and Diu Shops and Establishments Act, 1973, notified text (Goa Labour Department)](https://labour.goa.gov.in/wp-content/uploads/2020/07/7475-31-SI-EOG-1-GDD-Shops-Establishment-Act-1973-31-10-1974.pdf)
- [Goa Shops and Establishments Acts and Rules, PDF (Lawrbit)](https://www.lawrbit.com/wp-content/uploads/2020/08/goa-daman-and-diu-shops-and-establishments-acts-and-rules-daman-and-diu-state.pdf)
- [Section 23, Goa, Daman and Diu Shops and Establishments Act (Indian Kanoon)](https://indiankanoon.org/doc/79837751/)
- [Leave and working hours, Goa (Simpliance)](https://www.simpliance.in/India/LEI/working_hours/state-wise-leave-working-hours/goa)
- [Goa government notifies 2026 public holidays (Goa Government)](https://www.goa.gov.in/wp-content/uploads/2025/10/GOVT-NOTIFIES-PUBLIC-HOLIDAYS.pdf)
- [Goa holidays 2026 (greytHR)](https://www.greythr.com/wiki/acts/st-goa/holidays/2026/)
- [National Holidays 2026 (LKS Employment Law)](https://employmentlaw.lkslaw.com/holidays)
- [Public holiday for banks on 2nd and 4th Saturday (Taxheal)](https://www.taxheal.com/?p=1139)
- [Kerala public holidays 2026 notification (TeamLease RegTech)](https://teamleaseregtech.com/updates/article/49079/government-of-kerala-declaration-of-public-holidays-in-kerala-for-the-/)
- [Public holidays and the NI Act (iPleaders)](https://blog.ipleaders.in/?p=122273)
- [Increase in Maternity Benefit from 12 to 26 weeks (GConnect)](https://gconnect.in/?p=13338)
- [Amendments to the Maternity Benefit Act 1961 (SCC Online)](https://www.scconline.com/blog/post/2016/08/11/amendments-to-the-maternity-benefit-act-1961/)
- [26 weeks maternity leave confirmed (News on AIR)](https://www.newsonair.gov.in/after-amendment-in-maternity-benefit-act-1961-female-employees-are-getting-paid-leave-of-26-weeks-union-minister-mansukh-mandaviya)
- [EPFO makes UAN mandatory for all employers (Business Standard)](https://business-standard.com/amp/article/news-ani/epfo-makes-uan-mandatory-for-all-employers-under-its-purview-115062300461_1.html)
- [EPFO new UAN rule, Aadhaar face authentication (Outlook Money)](https://www.outlookmoney.com/retirement/invest/life-insurance-pension-plan/epfos-new-rule-for-uan-aadhaar-based-face-authentication-mandatory-on-umang-app)
- [DPDP countdown: employee data (Storyboard18)](https://www.storyboard18.com/how-it-works/dpdp-countdown-why-employee-data-is-india-inc-s-next-big-compliance-test-81627.htm)
- [Employee Data Privacy under the DPDP Act (Rainmaker)](https://rainmaker.co.in/employee-data-privacy-dpdp-act-hr-payroll-compliance-india/)
