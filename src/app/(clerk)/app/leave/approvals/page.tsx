import { getCurrentActor } from "@/shared/auth";
import { getApprovalScope, listApprovals } from "@/modules/leave/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { ApprovalsView } from "../_components/approvals-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const scope = await getApprovalScope(actor);
  if (!scope.canApprove) return <NoAccess />;
  const sp = await searchParams;
  const rows = await listApprovals(actor);
  return (
    <ApprovalsView rows={rows} pending={rows.length} isHr={actor.roles.includes("hr_admin")} saved={first(sp.saved)} error={first(sp.error)} />
  );
}
