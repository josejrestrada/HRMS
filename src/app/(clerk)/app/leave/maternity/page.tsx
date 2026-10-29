import Link from "next/link";
import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getLeaveEligibility } from "@/modules/leave/data";
import { NotLinked } from "../../_components/ui";
import { applyMaternityAction } from "../actions";
import { MaternityForm } from "../_components/family-forms";

export default async function MaternityPage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const eligibility = await getLeaveEligibility(actor);
  return (
    <>
      <div className="page-head">
        <p className="crumbs"><Link href="/app/leave">My leave</Link> / Maternity</p>
        <h1>Maternity leave</h1>
      </div>
      <section className="panel panel-form">
        {eligibility.maternity ? (
          <MaternityForm action={applyMaternityAction} today={todayIST()} />
        ) : (
          <p className="empty">Maternity leave is for women employees. If your details are not recorded correctly, please contact HR.</p>
        )}
      </section>
    </>
  );
}
