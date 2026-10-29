import { getCurrentActor } from "@/shared/auth";
import { getPeopleLookups, listEmployees } from "@/modules/employees/data";
import { listFilterSchema } from "@/modules/employees/schemas";
import { NoAccess } from "../_components/ui";
import { PeopleListView } from "./_components/people-list-view";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor?.roles.includes("hr_admin")) return <NoAccess />;

  const filter = listFilterSchema.parse(await searchParams);
  const [list, lookups] = await Promise.all([listEmployees(actor, filter), getPeopleLookups(actor)]);
  return <PeopleListView list={list} lookups={lookups} filter={filter} />;
}
