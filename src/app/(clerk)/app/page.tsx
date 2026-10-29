import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentActor } from "@/shared/auth";
import { getHrDashboard } from "@/modules/reports/data";
import { HrDashboardView } from "./_components/hr-dashboard";

// The proxy is only an early redirect. The real checks are here: signed in, linked to an
// employee, and (for the HR dashboard) holding the hr_admin role, checked again inside
// getHrDashboard.
export default async function AppHomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const actor = await getCurrentActor();

  if (!actor) {
    return (
      <div className="notice-card">
        <h1>Your account is not linked yet</h1>
        <p>
          You are signed in, but your account is not linked to an employee record, so there is
          nothing to show. Please ask HR to finish setting up your access.
        </p>
      </div>
    );
  }

  if (actor.roles.includes("hr_admin")) {
    const data = await getHrDashboard(actor);
    return <HrDashboardView data={data} userName={actor.fullName} />;
  }

  return (
    <div className="notice-card">
      <h1>Welcome, {actor.fullName}</h1>
      <p>
        Your dashboard is coming soon. In the meantime you can <Link href="/app/leave">see your leave and apply</Link>.
      </p>
    </div>
  );
}
