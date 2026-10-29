import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getMyAttendance } from "@/modules/attendance/data";
import { NotLinked } from "../_components/ui";
import { MyAttendanceView } from "./_components/my-attendance-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const sp = await searchParams;

  const today = todayIST();
  const m = /^(\d{4})-(\d{2})$/.exec(first(sp.m) ?? "");
  const year = m ? Number(m[1]) : Number(today.slice(0, 4));
  const month = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : Number(today.slice(5, 7));

  const data = await getMyAttendance(actor, year, month);
  return <MyAttendanceView data={data} isHr={actor.roles.includes("hr_admin")} saved={first(sp.saved)} time={first(sp.time)} error={first(sp.error)} />;
}
