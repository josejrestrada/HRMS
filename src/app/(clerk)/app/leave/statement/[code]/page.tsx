import { notFound } from "next/navigation";
import { getCurrentActor } from "@/shared/auth";
import { getStatement } from "@/modules/leave/data";
import { NotLinked } from "../../../_components/ui";
import { StatementView } from "../../_components/statement-view";

export default async function StatementPage({ params }: { params: Promise<{ code: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const { code } = await params;
  const statement = await getStatement(actor, code.toUpperCase());
  if (!statement) notFound();
  return <StatementView statement={statement} />;
}
