import { getCurrentActor } from "@/shared/auth";
import { getMyCompoff } from "@/modules/leave/data";
import { NotLinked } from "../../_components/ui";
import { CompoffView } from "../_components/compoff-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CompoffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const sp = await searchParams;
  const data = await getMyCompoff(actor);
  return <CompoffView credits={data.credits} requests={data.requests} saved={first(sp.saved)} error={first(sp.error)} />;
}
