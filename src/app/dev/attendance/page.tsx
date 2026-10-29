import { notFound } from "next/navigation";
import type { DaySheet, MyAttendance } from "@/modules/attendance/data";
import { deriveDay, summarizeMonth, type DayResult, type Policy, type PunchTime } from "@/modules/attendance/rules";
import { MyAttendanceView } from "../../(clerk)/app/attendance/_components/my-attendance-view";
import { TeamView } from "../../(clerk)/app/attendance/_components/team-view";

// Development-only design preview with made-up punches. It reads no database and no session, and it
// returns 404 in production. Use ?view=my | team
const policy: Policy = { workStart: "09:30", graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 270, lateMarksPerDeduction: 3, regularizeUntilDay: 5 };
const TODAY = "2026-10-21";

const io = (a: string, b?: string): PunchTime[] => [{ time: a, direction: "in" }, ...(b ? [{ time: b, direction: "out" as const }] : [])];
const punchesByDate: Record<string, PunchTime[]> = {
  "2026-10-01": io("09:25", "17:40"),
  "2026-10-05": io("10:05", "18:30"),
  "2026-10-06": io("09:30", "17:35"),
  "2026-10-07": io("09:28"), // missed check-out
  "2026-10-08": io("09:30", "13:40"), // short day
  "2026-10-09": io("09:50", "18:20"),
  "2026-10-12": io("09:30", "14:30"), // half day
  "2026-10-13": io("09:20", "17:30"),
  "2026-10-14": io("10:10", "18:40"),
  "2026-10-15": io("09:30", "17:45"),
  "2026-10-16": io("09:27", "17:33"),
  "2026-10-19": io("09:31", "17:55"),
  "2026-10-20": io("09:22", "17:40"),
  "2026-10-21": io("09:24"),
};

const days: DayResult[] = Array.from({ length: 31 }, (_, i) => {
  const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return deriveDay({
    date,
    today: TODAY,
    weeklyOff: weekday === 0 || weekday === 6,
    holiday: date === "2026-10-02" ? "Gandhi Jayanti" : null,
    leave: date === "2026-10-22" || date === "2026-10-23" ? "full" : date === "2026-10-02" ? null : null,
    wfh: date === "2026-10-26",
    punches: punchesByDate[date] ?? [],
    policy,
  });
});

const my: MyAttendance = {
  today: TODAY,
  year: 2026,
  month: 10,
  policy,
  days,
  summary: summarizeMonth(days, policy),
  next: "out",
  todayIn: "09:24",
  todayOut: null,
  canPunch: true,
};

const people = [
  ["KCF0001", "Asha Naik", "Finance", "Panaji", io("09:20", "17:40")],
  ["KCF0003", "Meera Fernandes", "Production", "Verna", io("09:10")],
  ["KCF0006", "Sanjay Gaonkar", "Production", "Verna", io("10:05")],
  ["KCF0010", "Rahul Volvoikar", "Sales", "Panaji", []],
  ["KCF0014", "Carlos Pereira", "Logistics", "Verna", io("09:35")],
] as const;

const sheetRows: DaySheet["rows"] = people.map(([code, fullName, department, location, punches], i) => ({
  id: String(i),
  code,
  fullName,
  department,
  location,
  day: deriveDay({ date: TODAY, today: TODAY, weeklyOff: false, holiday: null, leave: code === "KCF0014" ? "full" : null, wfh: false, punches: [...punches], policy }),
}));
const sheet: DaySheet = {
  date: TODAY,
  rows: sheetRows,
  counts: { present: 3, leave: 1 },
  notCheckedIn: 1,
  late: sheetRows.filter((r) => r.day.late).length,
};

export default async function AttendancePreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "my" } = await searchParams;
  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          {view === "team" ? <TeamView sheet={sheet} today={TODAY} /> : <MyAttendanceView data={my} isHr saved="in" time="09:24" />}
        </main>
      </div>
    </div>
  );
}
