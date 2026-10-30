import { getCurrentActor } from "@/shared/auth";
import { getPersonalDetails } from "@/modules/employees/data";
import { NotLinked } from "../_components/ui";
import { PersonalForm } from "../_components/personal-form";

export default async function PersonalDetailsPage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const details = await getPersonalDetails(actor, actor.employeeId);

  return (
    <>
      <div className="page-head">
        <h1>Personal details</h1>
        <p className="muted">
          Your PAN and the last 4 digits of your Aadhaar, kept for payroll and statutory records. They are shown masked, only you and HR can see them, and every change is recorded.
        </p>
      </div>
      <section className="panel panel-form">
        <PersonalForm details={details} isHr={false} />
      </section>
    </>
  );
}
