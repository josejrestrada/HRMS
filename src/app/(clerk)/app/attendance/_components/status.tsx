import type { DayStatus } from "@/modules/attendance/rules";

export const STATUS_INFO: Record<DayStatus, { label: string; short: string; cls: string }> = {
  present: { label: "Present", short: "Present", cls: "st-present" },
  half_day: { label: "Half day", short: "Half day", cls: "st-half" },
  absent: { label: "Absent", short: "Absent", cls: "st-absent" },
  leave: { label: "On leave", short: "Leave", cls: "st-leave" },
  holiday: { label: "Holiday", short: "Holiday", cls: "st-holiday" },
  weekly_off: { label: "Weekly off", short: "Off", cls: "st-off" },
  wfh: { label: "Work from home", short: "WFH", cls: "st-wfh" },
  missed_punch: { label: "Missed punch", short: "Missed punch", cls: "st-absent" },
  upcoming: { label: "Upcoming", short: "", cls: "st-upcoming" },
};

export function StatusChip({ status, provisional }: { status: DayStatus; provisional?: boolean }) {
  const info = STATUS_INFO[status];
  if (provisional && status === "absent") return <span className="chip">Not in yet</span>;
  return <span className={`chip st-chip ${info.cls}`}>{info.label}</span>;
}
