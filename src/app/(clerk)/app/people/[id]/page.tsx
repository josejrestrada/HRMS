import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getEmployeeProfile, getPeopleLookups, getPersonalDetails } from "@/modules/employees/data";
import { NoAccess } from "../../_components/ui";
import { ProfileView } from "../_components/profile-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SAVED: Record<string, string> = {
  created: "Employee added.",
  assignment: "Assignment changed. The previous one is kept in History.",
  deactivated: "Employee deactivated.",
  reactivated: "Employee reactivated.",
};

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const actor = await getCurrentActor();
  if (!actor?.roles.includes("hr_admin")) return <NoAccess />;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const form = first(sp.form);

  const profile = await getEmployeeProfile(actor, id);
  if (!profile) notFound();
  const lookups = form === "change" ? await getPeopleLookups(actor) : null;
  const tab = first(sp.tab) === "history" ? "history" : first(sp.tab) === "statutory" ? "statutory" : "overview";
  const personal = tab === "statutory" ? await getPersonalDetails(actor, id) : undefined;

  return (
    <ProfileView
      profile={profile}
      lookups={lookups}
      tab={tab}
      personal={personal}
      form={form}
      error={first(sp.error)}
      saved={SAVED[first(sp.saved) ?? ""]}
      actorEmployeeId={actor.employeeId}
      today={todayIST()}
    />
  );
}
