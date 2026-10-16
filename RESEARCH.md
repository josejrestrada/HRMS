# HRMS Research

These are my notes on how HR works in Indian companies, written before I design the HRMS. I picked Karnataka for the Shops and Establishments Act question. Where I could not confirm a figure from a reliable source I say so, and anything statutory needs checking against the bare Act before the system goes live.

## 1. What an Indian HR team keeps for every employee

HR teams usually record a person's identity details (full name as on PAN and Aadhaar, date of birth, gender, marital status, photo), contact details (personal and work email, mobile number, current and permanent address, an emergency contact), and employment details (employee code, designation, department, grade, reporting manager, joining date, employment type, work location, confirmation date, notice period and exit date). They also keep statutory IDs, payroll details such as bank account, IFSC and salary structure, background information like education and previous employers, and family information such as nominees for PF and gratuity.

Some of this is effectively mandatory because payroll cannot run legally without it. PAN is needed for TDS on salary, and bank details are needed to pay it. The UAN is mandatory for employers covered by the EPF Act and stays with the employee for life across jobs. Since August 2025 it is generated and activated through the UMANG app using Aadhaar face authentication, though I only found that in secondary sources. Aadhaar ties into UAN activation and PAN linking, but a company should collect it only where it is lawfully needed. ESI numbers apply only to employees under the ESI wage ceiling.

The sensitive fields are Aadhaar, PAN, bank account number, salary, date of birth, medical and disability information, marital and family details, background-check results and disciplinary records. Under the DPDP Act 2023 the employer is a data fiduciary and the employee is a data principal. Processing for employment is treated as a legitimate use, so explicit consent is not always needed, but it has to be limited to what is necessary. I did not manage to verify the penalty figure quoted online (up to Rs 250 crore).

For the system this means role-based access, masking of IDs (last four digits only), encryption at rest, an audit log when sensitive fields are viewed, no IDs in URLs or logs, and collecting only the minimum.

## 2. Employee codes

An employee code is normally a company prefix plus a zero-padded running number, such as ACME0001 or EMP-00123. Some firms add the joining year, a location or an employment type. The system generates it, nobody types it.

It should never change because everything else hangs off it: payroll history, leave balances, attendance, PF and ESI filings, Form 16, assets and appraisals. Changing it breaks audit trails and makes old filings hard to reconcile. It must also never be reused after someone leaves, or two people's histories get mixed. Codes should not embed things that change, like department or grade, because a transfer would make the code look wrong and tempt someone to edit it.

In the build, I will generate the code in the database, make it unique and immutable, keep it separate from the internal primary key, block edits at the API, and deactivate employees instead of deleting them.

## 3. Leave types

Casual leave (CL) covers short, unplanned personal needs of a day or two and is normally company policy. Sick leave (SL) covers illness, often needing a medical certificate for longer spells, and is also mostly policy, apart from ESI sickness benefit for covered staff. Earned or privilege leave (EL/PL) accrues with days worked and is statutory as annual leave with wages. For Karnataka the sources I found say one day for every 20 days worked, but they are compliance-site summaries and I want to check the Act itself.

Maternity leave is statutory under the Maternity Benefit Act 1961. It is 26 weeks for the first two children, with no more than 8 weeks before the expected delivery, and 12 weeks from the third child. Establishments with 50 or more employees must provide a creche. Paternity leave, typically 5 to 15 days, is company policy because there is no central private-sector law. Loss of pay (LOP) is not an entitlement at all, it is how unpaid absence is deducted from salary. Comp-off is time off in lieu of working on a weekly off or holiday, is policy, and usually expires after some weeks and needs approval.

The difference between statute and policy is that a statutory entitlement comes from a law, so an employer cannot offer less and can be penalised for refusing it. A company policy is extra, set in the appointment letter or handbook, and varies by company, but once promised it becomes contractual. The system should apply the more generous of the two for each leave type.

## 4. How leave accrues and what happens at year end

There are three common accrual patterns. Some companies credit the whole annual quota upfront on 1 January or 1 April, which is simple but over-grants if someone leaves early. Others credit a twelfth each month, which suits earned leave. Mid-year joiners usually get a pro-rated quota, counting the joining month if they joined on or before the 15th and rounding to the nearest half day.

Unused leave is handled in one of three ways. It can be carried forward, often with a cap such as 30 to 45 days for EL. It can lapse, which is typical for CL and SL. Or it can be encashed at year end or on exit, based on basic pay per day, which is common for EL.

For the build, I will store leave as a ledger of credits and debits rather than a single number, so every balance can be explained. Accrual and year-end jobs will be safe to re-run, and carry-forward cap, lapse and encashment will be set per leave type.

## 5. Karnataka Shops and Commercial Establishments Act, 1961

The Act is often cited as the 1962 Act because it was Act 8 of 1962 and came into force on 1 October 1964, so sources name it differently.

On working hours, the Act sets a maximum of 9 hours a day and 48 hours a week. A 2024 notification for certain establishments allows an 8-hour normal day with overtime up to 10 hours in total, and caps overtime at 50 hours over three months. I could not confirm whether that relaxation still applies, so it needs checking.

On weekly offs, an establishment must close at least one day a week and employees must get a rest day. Some categories are exempt from the closing-day rule, including medical shops, general stores, theatres, petrol bunks, hotels, clubs and IT and biotech services, but their staff still need a weekly rest day, arranged by rotation.

On leave, the Act gives annual leave with wages at one day per 20 days worked, or one per 15 for young persons. I could not confirm from the sources I reached what it says about casual or sick leave, so I have not stated any figures. That is an open item, and I plan to read the bare Act and the Karnataka Labour Department notifications to settle it.

## 6. National, restricted and state holidays

National holidays are 26 January, 15 August and 2 October, and every employer observes them. State holidays are notified by each state every year under Section 25 of the Negotiable Instruments Act, 1881, and state labour laws can add to them, as Kerala's festival holidays law does. Which list applies depends on the state where the employee works, so holidays have to be configured per location. Restricted or optional holidays are a longer list of festival days from which an employee picks a small number a year, commonly two or three, and the count is set by company policy.

Two caveats from my reading: banks close on the second and fourth Saturdays under the same section, and the Negotiable Instruments Act is really about when payment instruments mature, so a paid holiday for employees comes from shops and establishments or industrial holiday laws and the company's policy, not from that Act itself.

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
- **R2.** Balances are a ledger of credits and debits, and the displayed balance is the sum of the ledger.
- **R3.** Weekly offs (Saturday and Sunday by default, configurable per location) and holidays inside a leave range are not counted as leave days. Maternity leave is the exception and counts calendar days.
- **R4.** For each leave type, the more generous of the statute and company policy applies.
- **R5.** Only active employees can apply. Employees on probation get the same entitlements unless a leave type says otherwise.

### Entitlements
- **R6.** Casual leave: 8 days a year, credited upfront on 1 January and pro-rated for joiners. It lapses at year end, cannot be encashed, and is limited to 3 consecutive days.
- **R7.** Sick leave: 8 days a year, credited upfront and pro-rated for joiners. It lapses at year end, cannot be encashed, and needs a medical certificate beyond 2 consecutive days.
- **R8.** Earned leave: 18 days a year, accruing 1.5 days a month, usable after 6 months of service. Up to 30 days carry forward, and anything above that is encashed at year end. Unused balance is also encashed on exit. The statutory floor of one day per 20 days worked always applies.
- **R9.** Maternity leave: 26 weeks for the first two children and 12 weeks after that, with up to 8 weeks before the expected delivery. It is for female employees and counts calendar days.
- **R10.** Paternity leave: 5 days for male employees, taken within 3 months of the birth.
- **R11.** Comp-off: one day for each extra day worked on a weekly off or holiday, credited on manager approval, with prior approval required and an expiry of 60 days from credit.
- **R12.** Loss of pay is unlimited and unpaid, and is used when the balance is insufficient.

### Accrual and pro-rating
- **R13.** For upfront leave types, a mid-year joiner gets the quota times months remaining divided by 12, rounded up to the nearest half day, and the joining month counts if the joining date is on or before the 15th.
- **R14.** Earned leave accrues on the last day of each month, reduced in proportion to LOP days in that month.
- **R15.** A leaver gets no accrual after their last working day.

### Applying and approving
- **R16.** An application states the type, start date, end date, whether it is a half day (first or second half) and a reason.
- **R17.** An application is rejected if it overlaps another approved or pending leave for the same employee.
- **R18.** An application is rejected if the balance is insufficient, unless the employee chooses to convert the shortfall to LOP.
- **R19.** Backdated applications are accepted up to 7 days. Older ones need HR approval.
- **R20.** The manager approves or rejects. If nothing happens within 5 working days it escalates to HR. Cancelling an approved leave restores the balance.
- **R21.** Approved leave cannot be edited. It must be cancelled and re-applied.

### Year end (31 December, safe to re-run)
- **R22.** CL and SL balances lapse.
- **R23.** EL carries forward up to 30 days and the excess is encashed at basic divided by 30 per day.
- **R24.** Comp-off expires 60 days after it is credited, whatever the year.
- **R25.** Every lapse, carry-forward and encashment is written to the ledger with a reason.

### Attendance
- **R26.** There is a 15-minute grace window. Three late marks in a month deduct half a day, from CL first and then LOP.
- **R27.** Under 4.5 hours worked is absent unless leave is applied, 4.5 hours up to 8 hours is a half day, and 8 hours or more is present. Approved work from home counts as present.
- **R28.** Missed punches must be regularized by the 5th of the next month, after which the day becomes LOP.

### Still to resolve
- The exact Karnataka statutory casual and sick leave and any holiday entitlement.
- Whether restricted holidays are in scope for the first version.
- Whether the target company uses an April to March leave year instead.

## Sources

- [Karnataka Shops and Establishment Act: Scope, Registration, Compliance (India Briefing)](https://www.india-briefing.com/news/karnataka-shops-establishment-act-19012.html/)
- [Karnataka Shops and Establishments Act (Keka)](https://www.keka.com/compliance/acts/karnataka-shops-and-establishments-act)
- [Karnataka Shops and Commercial Establishments Acts and Rules, PDF (Lawrbit)](https://www.lawrbit.com/wp-content/uploads/2020/08/karnataka-shops-and-commercial-establishment-acts-and-rules.pdf)
- [The Karnataka Shops and Commercial Establishments Act, 1961 (Corrida Legal)](https://corridalegal.com/the-karnataka-shops-and-commercial-establishments-act-1961-executive-summary-and-bare-act/)
- [JSA Prism, Employment, October 2024](https://www.jsalaw.com/newsletters-and-updates/jsa-prism-employment-october-2024-2/)
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
