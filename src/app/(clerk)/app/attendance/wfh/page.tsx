import { getCurrentActor } from "@/shared/auth";
import { getAttendanceApprovalScope, getMyWfh } from "@/modules/attendance/data";
import { NotLinked } from "../../_components/ui";
import { WfhView } from "../_components/wfh-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WfhPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const sp = await searchParams;
  const [data, scope] = await Promise.all([getMyWfh(actor), getAttendanceApprovalScope(actor)]);
  return (
    <WfhView
      data={data}
      isHr={actor.roles.includes("hr_admin")}
      canApprove={scope.canApprove}
      pending={scope.pending}
      saved={first(sp.saved)}
      count={first(sp.count)}
      skipped={first(sp.skipped)}
      error={first(sp.error)}
    />
  );
}
