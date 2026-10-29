import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getDaySheet } from "@/modules/attendance/data";
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const sheet = await getDaySheet(actor, date);
  return <TeamView sheet={sheet} today={today} />;
}
