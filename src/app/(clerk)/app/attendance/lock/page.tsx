import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { todayIST } from "@/shared/dates";
import { getAttendanceApprovalScope, getLockOverview, previewMonthLock, type LockPreview } from "@/modules/attendance/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { LockView } from "../_components/lock-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MonthLockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  if (!actor.roles.includes("hr_admin")) return <NoAccess />;
  const sp = await searchParams;

  const year = Number(first(sp.year)) || Number(todayIST().slice(0, 4));
  const monthParam = Number(first(sp.month));
  let error = first(sp.error);
  let preview: LockPreview | undefined;
  if (Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12) {
    try {
      preview = await previewMonthLock(actor, year, monthParam);
    } catch (err) {
      if (err instanceof DomainError) error = err.message;
      else throw err;
    }
  }
  const [months, scope] = await Promise.all([getLockOverview(actor, year), getAttendanceApprovalScope(actor)]);
  const saved = first(sp.saved) === "locked" ? { month: first(sp.month) ?? "", people: first(sp.people) ?? "0", unpaid: first(sp.unpaid) ?? "0" } : undefined;
  return <LockView year={year} months={months} preview={saved ? undefined : preview} canApprove={scope.canApprove} pendingApprovals={scope.pending} saved={saved} error={error} />;
}
