import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { getEmployeeMonthForHr } from "@/modules/attendance/data";
import { getEmployeeLeaveForHr } from "@/modules/leave/data";
import { getEmployeeProfile, getPeopleLookups, getBankDetails, getPersonalDetails } from "@/modules/employees/data";
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
  const t = first(sp.tab);
  const tab = t === "history" ? "history" : t === "personal" || t === "statutory" ? "personal" : t === "bank" ? "bank" : t === "leave" ? "leave" : t === "attendance" ? "attendance" : "overview";
  const personal = tab === "personal" ? await getPersonalDetails(actor, id) : undefined;
  const bank = tab === "bank" ? await getBankDetails(actor, id) : undefined;
  const leave = tab === "leave" ? await getEmployeeLeaveForHr(actor, id) : undefined;
  const today = todayIST();
  const m = /^(\d{4})-(\d{2})$/.exec(first(sp.m) ?? "");
  const year = m ? Number(m[1]) : Number(today.slice(0, 4));
  const monthNo = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : Number(today.slice(5, 7));
  const month = tab === "attendance" ? await getEmployeeMonthForHr(actor, id, year, monthNo) : undefined;

  return (
    <ProfileView
      profile={profile}
      lookups={lookups}
      tab={tab}
      personal={personal}
      bank={bank}
      leave={leave}
      month={month}
      form={form}
      error={first(sp.error)}
      saved={SAVED[first(sp.saved) ?? ""]}
      actorEmployeeId={actor.employeeId}
      today={today}
    />
  );
}
