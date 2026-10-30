import { getCurrentActor } from "@/shared/auth";
import { getAttendanceApprovalScope, listRegularizationApprovals, listWfhApprovals } from "@/modules/attendance/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { AttendanceApprovalsView } from "../_components/approvals-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AttendanceApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const scope = await getAttendanceApprovalScope(actor);
  if (!scope.canApprove) return <NoAccess />;
  const sp = await searchParams;
  const [rows, wfh] = await Promise.all([listRegularizationApprovals(actor), listWfhApprovals(actor)]);
  return <AttendanceApprovalsView rows={rows} wfh={wfh} isHr={actor.roles.includes("hr_admin")} saved={first(sp.saved)} count={first(sp.count)} error={first(sp.error)} />;
}
