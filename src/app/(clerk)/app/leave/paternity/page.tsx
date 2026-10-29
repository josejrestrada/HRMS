import Link from "next/link";
import { getCurrentActor } from "@/shared/auth";
import { getApplyContext, getLeaveEligibility } from "@/modules/leave/data";
import { NotLinked } from "../../_components/ui";
import { applyPaternityAction } from "../actions";
import { PaternityForm } from "../_components/family-forms";

export default async function PaternityPage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const [eligibility, context] = await Promise.all([getLeaveEligibility(actor), getApplyContext(actor)]);
  return (
    <>
      <div className="page-head">
        <p className="crumbs"><Link href="/app/leave">My leave</Link> / Paternity</p>
        <h1>Paternity leave</h1>
      </div>
      <section className="panel panel-form">
        {eligibility.paternity && context ? (
          <PaternityForm action={applyPaternityAction} weeklyOffDays={context.weeklyOffDays} holidays={context.holidays} />
        ) : (
          <p className="empty">Paternity leave is for male employees. If your details are not recorded correctly, please contact HR.</p>
        )}
      </section>
    </>
  );
}
