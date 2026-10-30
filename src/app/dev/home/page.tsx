import { notFound } from "next/navigation";
import type { EmployeeHome } from "@/modules/reports/home";
import { EmployeeHomeView } from "../../(clerk)/app/_components/employee-home";
import { previewPunch } from "./actions";

// Development-only design preview with made-up data. It reads no database and no session, and it returns 404
// in production. Use ?view=busy | quiet | holiday
const balances = [
  { code: "CL", name: "Casual leave", available: 5, held: 1 },
  { code: "SL", name: "Sick leave", available: 9, held: 0 },
  { code: "EL", name: "Earned leave", available: 10.5, held: 3 },
];

const busy: EmployeeHome = {
  today: "2026-10-30",
  status: { label: "Checked in", detail: "Since 09:20", tone: "ok" },
  canPunch: true,
  next: "out",
  balances,
  upcoming: [
    { kind: "wfh", date: "2026-11-03", endDate: "2026-11-03", title: "Work from home", status: "pending" },
    { kind: "leave", date: "2026-11-05", endDate: "2026-11-05", title: "Casual leave", status: "approved" },
    { kind: "leave", date: "2026-11-09", endDate: "2026-11-11", title: "Earned leave", status: "pending" },
    { kind: "holiday", date: "2026-12-03", endDate: "2026-12-03", title: "Feast of St Francis Xavier", status: null },
  ],
  attention: [
    { text: "3 days need fixing before 5 Nov 2026.", href: "/app/attendance", tone: "warn" },
    { text: "2 leave requests are waiting for you.", href: "/app/leave/approvals", tone: "info" },
  ],
};

export default async function HomePreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "busy" } = await searchParams;
  const data: EmployeeHome =
    view === "quiet"
      ? { ...busy, status: { label: "Not checked in yet", detail: null, tone: "muted" }, next: "in", upcoming: [], attention: [] }
      : view === "holiday"
        ? { ...busy, status: { label: "Holiday", detail: "Goa Liberation Day", tone: "muted" }, canPunch: false, attention: [] }
        : busy;
  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          <EmployeeHomeView data={data} userName="TEST Asha Naik" punch={previewPunch} />
        </main>
      </div>
    </div>
  );
}
