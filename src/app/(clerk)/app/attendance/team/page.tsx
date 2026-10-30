import { getCurrentActor } from "@/shared/auth";
import { isRealDate, todayIST } from "@/shared/dates";
import { getAttendanceApprovalScope, getDaySheet } from "@/modules/attendance/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { TeamView } from "../_components/team-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TeamAttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  if (!actor.roles.includes("hr_admin")) return <NoAccess />;
  const sp = await searchParams;
  const today = todayIST();
  const requested = first(sp.date) ?? "";
  // A date that does not exist (31 February) or lies in the future falls back to today.
  const date = isRealDate(requested) && requested <= today ? requested : today;
  const [sheet, scope] = await Promise.all([getDaySheet(actor, date), getAttendanceApprovalScope(actor)]);
  return <TeamView sheet={sheet} today={today} pending={scope.pending} />;
}
