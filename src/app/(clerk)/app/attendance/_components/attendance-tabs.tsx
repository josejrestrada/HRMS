import Link from "next/link";

export function AttendanceTabs({ current, isHr }: { current: "my" | "team"; isHr: boolean }) {
  if (!isHr) return null;
  const tab = (key: string, href: string, label: string) => (
    <Link href={href} className={current === key ? "tab tab-current" : "tab"} aria-current={current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="tabs" aria-label="Attendance sections">
      {tab("my", "/app/attendance", "My attendance")}
      {tab("team", "/app/attendance/team", "Team today")}
    </nav>
  );
}
