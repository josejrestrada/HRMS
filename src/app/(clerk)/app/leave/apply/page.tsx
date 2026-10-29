import Link from "next/link";
import { getCurrentActor } from "@/shared/auth";
import { getApplyContext } from "@/modules/leave/data";
import { NotLinked } from "../../_components/ui";
import { applyLeaveAction } from "../actions";
import { ApplyForm } from "../_components/apply-form";

export default async function ApplyLeavePage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const context = await getApplyContext(actor);

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/app/leave">My leave</Link> / Apply
        </p>
        <h1>Apply for leave</h1>
      </div>
      <section className="panel panel-form">
        {context ? (
          <ApplyForm context={context} action={applyLeaveAction} />
        ) : (
          <p className="empty">You do not have a current job assignment yet, so leave cannot be requested. Please contact HR.</p>
        )}
      </section>
    </>
  );
}
