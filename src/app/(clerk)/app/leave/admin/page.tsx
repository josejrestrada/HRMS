import { getCurrentActor } from "@/shared/auth";
import { todayIST } from "@/shared/dates";
import { DomainError } from "@/shared/errors";
import { getApprovalScope, previewYearEnd, type YearEndSummary } from "@/modules/leave/data";
import { NoAccess, NotLinked } from "../../_components/ui";
import { AdminView, type YearEndResult } from "../_components/admin-view";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LeaveAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  if (!actor.roles.includes("hr_admin")) return <NoAccess />;
  const sp = await searchParams;
  const scope = await getApprovalScope(actor);
  const today = todayIST();
  const year = Number(today.slice(0, 4));

  const result =
    first(sp.saved) === "credits"
      ? { year: first(sp.year) ?? "", grants: first(sp.grants) ?? "0", accruals: first(sp.accruals) ?? "0" }
      : undefined;

  const yearEndResult: YearEndResult | undefined =
    first(sp.saved) === "yearend"
      ? {
          year: first(sp.year) ?? "",
          people: first(sp.people) ?? "0",
          lines: (first(sp.lines) ?? "")
            .split(",")
            .filter(Boolean)
            .map((part) => {
              const [code, lapsed, encashed, carried] = part.split(":");
              return { code, lapsed: Number(lapsed) || 0, encashed: Number(encashed) || 0, carried: Number(carried) || 0 };
            }),
        }
      : undefined;

  const requested = Number(first(sp.yearEnd));
  const yearEndYear = Number.isInteger(requested) && first(sp.yearEnd) ? requested : year;
  let yearEndPreview: YearEndSummary | undefined;
  let error = first(sp.error);
  if (first(sp.yearEnd)) {
    try {
      yearEndPreview = await previewYearEnd(actor, yearEndYear);
    } catch (err) {
      if (err instanceof DomainError) error = err.message;
      else throw err;
    }
  }

  return (
    <AdminView
      year={year}
      canApprove={scope.canApprove}
      pending={scope.pending}
      result={result}
      yearEndResult={yearEndResult}
      yearEndPreview={yearEndPreview}
      yearEndYear={yearEndYear}
      error={error}
    />
  );
}
