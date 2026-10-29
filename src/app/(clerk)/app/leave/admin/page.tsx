import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getApprovalScope } from "@/modules/leave/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { AdminView } from "../_components/admin-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LeaveAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  if (!actor.roles.includes("hr_admin")) return <NoAccess />;
  const sp = await searchParams;
  const scope = await getApprovalScope(actor);
  const result =
    first(sp.saved) === "credits"
      ? { year: first(sp.year) ?? "", grants: first(sp.grants) ?? "0", accruals: first(sp.accruals) ?? "0" }
      : undefined;
  return (
    <AdminView year={Number(todayIST().slice(0, 4))} canApprove={scope.canApprove} pending={scope.pending} result={result} error={first(sp.error)} />
  );
}
