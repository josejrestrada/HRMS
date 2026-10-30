import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { ForbiddenError } from "@/shared/roles";
import { exportReportCsv } from "@/modules/reports/data";

// The role is checked again inside the reports data layer; here we only turn its errors into responses.
export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Sign in first.", { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const { filename, csv } = await exportReportCsv(actor, params.get("report") ?? "", {
      year: params.get("year") ? Number(params.get("year")) : undefined,
      month: params.get("month") ? Number(params.get("month")) : undefined,
    });
    return new Response("﻿" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Only HR can download reports.", { status: 403 });
    if (err instanceof DomainError) return new Response(err.message, { status: 400 });
    throw err;
  }
}
