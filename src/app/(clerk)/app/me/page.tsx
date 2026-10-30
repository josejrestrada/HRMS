import { getCurrentActor } from "@/shared/auth";
import { getEmployeeHome } from "@/modules/reports/data";
import { NotLinked } from "../_components/ui";
import { EmployeeHomeView } from "../_components/employee-home";

// The personal home screen for anyone, including HR (whose /app is the company dashboard).
export default async function MyHomePage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  return <EmployeeHomeView data={await getEmployeeHome(actor)} userName={actor.fullName} />;
}
