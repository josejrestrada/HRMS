import { getCurrentActor } from "@/shared/auth";
import { getApprovalScope, getLeaveEligibility, getLeaveOverview } from "@/modules/leave/data";
import { NotLinked } from "../_components/ui";
import { OverviewView } from "./_components/overview-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LeavePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const sp = await searchParams;
  const [overview, scope, eligibility] = await Promise.all([getLeaveOverview(actor), getApprovalScope(actor), getLeaveEligibility(actor)]);
  return (
    <OverviewView
      overview={overview}
      canApprove={scope.canApprove}
      pending={scope.pending}
      isHr={actor.roles.includes("hr_admin")}
      eligibility={eligibility}
      saved={first(sp.saved)}
      error={first(sp.error)}
    />
  );
}
