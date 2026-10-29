import Link from "next/link";

export function LeaveTabs(props: { current: "my" | "approvals" | "admin"; canApprove: boolean; pending: number; isHr: boolean }) {
  const tab = (key: string, href: string, label: React.ReactNode) => (
    <Link href={href} className={props.current === key ? "tab tab-current" : "tab"} aria-current={props.current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="tabs" aria-label="Leave sections">
      {tab("my", "/app/leave", "My leave")}
      {props.canApprove
        ? tab("approvals", "/app/leave/approvals", <>Approvals {props.pending > 0 ? <span className="chip chip-warn">{props.pending}</span> : null}</>)
        : null}
      {props.isHr ? tab("admin", "/app/leave/admin", "Admin") : null}
    </nav>
  );
}
