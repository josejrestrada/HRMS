import Link from "next/link";
import { getCurrentActor } from "@/shared/auth";
import { getPeopleLookups } from "@/modules/employees/data";
import { NoAccess } from "../../_components/ui";
import { createEmployeeAction } from "../actions";
import { EmployeeForm } from "../_components/employee-form";

export default async function NewEmployeePage() {
  const actor = await getCurrentActor();
  if (!actor?.roles.includes("hr_admin")) return <NoAccess />;
  const lookups = await getPeopleLookups(actor);

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/app/people">People</Link> / New
        </p>
        <h1>Add employee</h1>
        <p className="muted">
          The employee code is created automatically and can never be changed. You can invite them to sign in afterwards.
        </p>
      </div>
      <section className="panel panel-form">
        <EmployeeForm mode="create" action={createEmployeeAction} lookups={lookups} cancelHref="/app/people" />
      </section>
    </>
  );
}
