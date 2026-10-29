import { notFound } from "next/navigation";
import type { ApplyContext, ApprovalRow, CompoffApprovalRow, CompoffCreditRow, CompoffRequestRow, LeaveOverview, Statement } from "@/modules/leave/data";
import { applyLeaveAction } from "../../(clerk)/app/leave/actions";
import { AdminView } from "../../(clerk)/app/leave/_components/admin-view";
import { ApplyForm } from "../../(clerk)/app/leave/_components/apply-form";
import { ApprovalsView } from "../../(clerk)/app/leave/_components/approvals-view";
import { OverviewView } from "../../(clerk)/app/leave/_components/overview-view";
import { CompoffView } from "../../(clerk)/app/leave/_components/compoff-view";
import { MaternityForm, PaternityForm } from "../../(clerk)/app/leave/_components/family-forms";
import { StatementView } from "../../(clerk)/app/leave/_components/statement-view";
import { applyMaternityAction, applyPaternityAction } from "../../(clerk)/app/leave/actions";

// Development-only design preview with made-up numbers. It reads no database and no session, and it
// returns 404 in production. Use ?view=overview | apply | statement | approvals | admin
const overview: LeaveOverview = {
  today: "2026-10-30",
  balances: [
    { typeId: "t1", code: "CL", name: "Casual leave", annualQuota: 8, balance: 6, held: 1, available: 5 },
    { typeId: "t2", code: "SL", name: "Sick leave", annualQuota: 9, balance: 9, held: 0, available: 9 },
    { typeId: "t3", code: "EL", name: "Earned leave", annualQuota: 18, balance: 13.5, held: 3, available: 10.5 },
  ],
  requests: [
    { id: "r1", typeCode: "EL", typeName: "Earned leave", startDate: "2026-11-09", endDate: "2026-11-11", dayPart: "full", days: 3, lopDays: 0, status: "pending", reason: "Family function", decisionNote: null, certificateRequired: false, canCancel: true },
    { id: "r2", typeCode: "CL", typeName: "Casual leave", startDate: "2026-11-05", endDate: "2026-11-05", dayPart: "first_half", days: 0.5, lopDays: 0, status: "approved", reason: null, decisionNote: null, certificateRequired: false, canCancel: true },
    { id: "r3", typeCode: "SL", typeName: "Sick leave", startDate: "2026-10-12", endDate: "2026-10-14", dayPart: "full", days: 3, lopDays: 0, status: "approved", reason: "Fever", decisionNote: null, certificateRequired: true, canCancel: false },
    { id: "r4", typeCode: "CL", typeName: "Casual leave", startDate: "2026-09-21", endDate: "2026-09-22", dayPart: "full", days: 2, lopDays: 0, status: "rejected", reason: null, decisionNote: "Month-end closing, please pick another week.", certificateRequired: false, canCancel: false },
    { id: "r5", typeCode: "EL", typeName: "Earned leave", startDate: "2026-08-03", endDate: "2026-08-07", dayPart: "full", days: 5, lopDays: 2, status: "approved", reason: null, decisionNote: null, certificateRequired: false, canCancel: false },
  ],
};

const context: ApplyContext = {
  today: "2026-10-30",
  locationName: "Panaji",
  weeklyOffDays: [0, 6],
  holidays: { "2026-12-03": "Feast of St Francis Xavier", "2026-12-19": "Goa Liberation Day", "2026-12-25": "Christmas" },
  types: [
    { id: "t1", code: "CL", name: "Casual leave", maxConsecutiveDays: 3, available: 5 },
    { id: "t2", code: "SL", name: "Sick leave", maxConsecutiveDays: null, available: 9 },
    { id: "t3", code: "EL", name: "Earned leave", maxConsecutiveDays: null, available: 10.5 },
    { id: "t4", code: "LOP", name: "Leave without pay", maxConsecutiveDays: null, available: 0 },
  ],
};

const statement: Statement = {
  code: "EL",
  name: "Earned leave",
  balance: 13.5,
  held: 3,
  entries: [
    { id: "9", date: "2026-10-30", reason: "pending_hold", delta: -3, isHold: true, running: null, note: null },
    { id: "8", date: "2026-10-30", reason: "accrual", delta: 1.5, isHold: false, running: 13.5, note: "EL accrual for 2026-09" },
    { id: "7", date: "2026-08-07", reason: "application", delta: -3, isHold: false, running: 12, note: null },
    { id: "6", date: "2026-08-03", reason: "hold_release", delta: 3, isHold: true, running: null, note: null },
    { id: "5", date: "2026-07-31", reason: "accrual", delta: 1.5, isHold: false, running: 15, note: "EL accrual for 2026-07" },
  ],
};

const approvals: ApprovalRow[] = [
  { id: "a1", employeeId: "e1", employeeCode: "KCF0016", employeeName: "Nikhil Mhambre", typeCode: "SL", typeName: "Sick leave", startDate: "2026-10-30", endDate: "2026-11-03", dayPart: "full", days: 3, lopDays: 0, reason: "Viral fever, doctor advised rest", certificateRequired: true, waitingDays: 0 },
  { id: "a2", employeeId: "e2", employeeCode: "KCF0011", employeeName: "Sneha Pednekar", typeCode: "EL", typeName: "Earned leave", startDate: "2026-11-09", endDate: "2026-11-13", dayPart: "full", days: 5, lopDays: 2, reason: null, certificateRequired: false, waitingDays: 6 },
];

const compoffApprovals: CompoffApprovalRow[] = [
  { id: "c1", employeeId: "e3", employeeCode: "KCF0006", employeeName: "Sanjay Gaonkar", workedDate: "2026-10-24", days: 1, reason: "Month-end dispatch on Saturday", waitingDays: 2 },
];
const compoffCredits: CompoffCreditRow[] = [
  { id: "k2", earnedOn: "2026-10-26", days: 1, remaining: 1, expiresOn: "2026-12-25", expired: false },
  { id: "k1", earnedOn: "2026-08-03", days: 0.5, remaining: 0, expiresOn: "2026-10-02", expired: true },
];
const compoffRequests: CompoffRequestRow[] = [
  { id: "q2", workedDate: "2026-10-24", days: 1, status: "pending", reason: null, decisionNote: null, canCancel: true },
  { id: "q1", workedDate: "2026-10-17", days: 1, status: "approved", reason: null, decisionNote: null, canCancel: false },
];

export default async function LeavePreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "overview" } = await searchParams;
  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          {view === "apply" ? (
            <section className="panel panel-form">
              <h1 className="panel-title">Apply for leave</h1>
              <ApplyForm context={context} action={applyLeaveAction} />
            </section>
          ) : view === "maternity" ? (
            <section className="panel panel-form">
              <h1 className="panel-title">Maternity leave</h1>
              <MaternityForm action={applyMaternityAction} today="2026-10-30" />
            </section>
          ) : view === "paternity" ? (
            <section className="panel panel-form">
              <h1 className="panel-title">Paternity leave</h1>
              <PaternityForm action={applyPaternityAction} weeklyOffDays={[0, 6]} holidays={context.holidays} />
            </section>
          ) : view === "compoff" ? (
            <CompoffView credits={compoffCredits} requests={compoffRequests} saved="requested" />
          ) : view === "statement" ? (
            <StatementView statement={statement} />
          ) : view === "approvals" ? (
            <ApprovalsView rows={approvals} compoff={compoffApprovals} pending={3} isHr saved="approved" />
          ) : view === "admin" ? (
            <AdminView
              year={2026}
              canApprove
              pending={2}
              result={{ year: "2026", grants: "46", accruals: "180" }}
              yearEndYear={2026}
              yearEndPreview={{
                year: 2026,
                applied: false,
                canRun: false,
                employees: 23,
                lines: [
                  { code: "CL", name: "Casual leave", people: 21, lapsed: 74, encashed: 0, carried: 0 },
                  { code: "SL", name: "Sick leave", people: 23, lapsed: 190.5, encashed: 0, carried: 0 },
                  { code: "EL", name: "Earned leave", people: 23, lapsed: 0, encashed: 12, carried: 388.5 },
                ],
              }}
            />
          ) : (
            <OverviewView overview={overview} canApprove pending={2} isHr eligibility={{ maternity: true, paternity: false }} saved="applied" />
          )}
        </main>
      </div>
    </div>
  );
}
