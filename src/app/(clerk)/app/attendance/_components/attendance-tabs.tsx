import Link from "next/link";

export function AttendanceTabs(props: {
  current: "my" | "approvals" | "team";
  isHr: boolean;
  canApprove?: boolean;
  pending?: number;
}) {
  const tab = (key: string, href: string, label: React.ReactNode) => (
    <Link href={href} className={props.current === key ? "tab tab-current" : "tab"} aria-current={props.current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  if (!props.isHr && !props.canApprove) return null;
  return (
    <nav className="tabs" aria-label="Attendance sections">
      {tab("my", "/app/attendance", "My attendance")}
      {props.canApprove
        ? tab("approvals", "/app/attendance/approvals", <>Approvals {props.pending ? <span className="chip chip-warn">{props.pending}</span> : null}</>)
        : null}
      {props.isHr ? tab("team", "/app/attendance/team", "Team today") : null}
    </nav>
  );
}
