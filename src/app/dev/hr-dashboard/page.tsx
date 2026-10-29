import { notFound } from "next/navigation";
import type { HrDashboard } from "@/modules/reports/data";
import { HrDashboardView } from "../../(clerk)/app/_components/hr-dashboard";

// Development-only design preview with made-up numbers. It reads no database and no session,
// and returns 404 in production.
const data: HrDashboard = {
  today: "2026-10-29",
  headcount: {
    total: 23,
    byLocation: [
      { name: "Verna", count: 14 },
      { name: "Panaji", count: 9 },
    ],
    byType: [
      { type: "permanent", count: 16 },
      { type: "probation", count: 3 },
      { type: "contract", count: 2 },
      { type: "intern", count: 2 },
    ],
  },
  byDepartment: [
    { name: "Production", count: 8 },
    { name: "Sales", count: 4 },
    { name: "Finance", count: 4 },
    { name: "Quality", count: 3 },
    { name: "Logistics", count: 3 },
    { name: "Human Resources", count: 1 },
  ],
  onLeaveTotal: 3,
  onLeave: [
    { employeeCode: "KCF0006", fullName: "Sanjay Gaonkar", leaveCode: "SL", dayPart: "full", startDate: "2026-10-28", endDate: "2026-10-30" },
    { employeeCode: "KCF0010", fullName: "Rahul Volvoikar", leaveCode: "CL", dayPart: "first_half", startDate: "2026-10-29", endDate: "2026-10-29" },
    { employeeCode: "KCF0015", fullName: "Deepa Kerkar", leaveCode: "EL", dayPart: "full", startDate: "2026-10-27", endDate: "2026-11-01" },
  ],
  pending: {
    count: 4,
    oldestAgeDays: 6,
    items: [
      { employeeCode: "KCF0018", fullName: "Imran Shaikh", leaveCode: "CL", startDate: "2026-11-05", endDate: "2026-11-05", days: 1, waitingDays: 6 },
      { employeeCode: "KCF0011", fullName: "Sneha Pednekar", leaveCode: "EL", startDate: "2026-11-08", endDate: "2026-11-12", days: 5, waitingDays: 4 },
      { employeeCode: "KCF0007", fullName: "Neha Prabhu", leaveCode: "CL", startDate: "2026-11-02", endDate: "2026-11-03", days: 2, waitingDays: 1 },
      { employeeCode: "KCF0013", fullName: "Divya Rane", leaveCode: "SL", startDate: "2026-10-30", endDate: "2026-10-30", days: 1, waitingDays: 0 },
    ],
  },
  attendance: { counts: { present: 12, wfh: 2, half_day: 1, leave: 3, absent: 1 }, recorded: 19, notRecorded: 4 },
  holidays: [
    { date: "2026-12-03", name: "Feast of St Francis Xavier", type: "state", verified: false, locations: ["Panaji", "Verna"] },
    { date: "2026-12-19", name: "Goa Liberation Day", type: "state", verified: false, locations: ["Panaji", "Verna"] },
    { date: "2026-12-25", name: "Christmas", type: "state", verified: false, locations: ["Panaji", "Verna"] },
  ],
  recentJoiners: [
    { employeeCode: "KCF0022", fullName: "Sheetal Mapari", designation: "Store Keeper", location: "Verna", joiningDate: "2026-10-23" },
    { employeeCode: "KCF0021", fullName: "Amit Bandekar", designation: "Sales Executive", location: "Panaji", joiningDate: "2026-10-15" },
    { employeeCode: "KCF0020", fullName: "Rutuja Salgaonkar", designation: "Machine Operator", location: "Verna", joiningDate: "2026-10-04" },
  ],
  attention: { withoutManager: 5, notSignedIn: 22, unassigned: 1 },
};

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          <HrDashboardView data={data} userName="Preview Admin" />
        </main>
      </div>
    </div>
  );
}
