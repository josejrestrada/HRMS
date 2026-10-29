import Link from "next/link";

export const TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  probation: "Probation",
  contract: "Contract",
  intern: "Intern",
};

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Up to two initials. A leading "TEST" token (the marker on seeded test data) is ignored. */
export function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => w && w !== "TEST");
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function displayName(name: string) {
  return name.replace(/^TEST\s+/, "");
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <span className={large ? "avatar avatar-large" : "avatar"} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function NoAccess() {
  return (
    <div className="notice-card">
      <h1>You do not have access to this page</h1>
      <p>This area is for HR administrators. If you think you should have access, please ask HR.</p>
      <p>
        <Link href="/app">Back to your dashboard</Link>
      </p>
    </div>
  );
}

export function dateRange(start: string, end: string, format: (d: string) => string) {
  return start === end ? format(start) : `${format(start)} to ${format(end)}`;
}

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function statusChipClass(status: string) {
  if (status === "approved") return "chip chip-ok";
  if (status === "pending") return "chip chip-warn";
  if (status === "rejected") return "chip chip-bad";
  return "chip";
}

export function partLabel(part: string) {
  return part === "first_half" ? " (first half)" : part === "second_half" ? " (second half)" : "";
}

export function NotLinked() {
  return (
    <div className="notice-card">
      <h1>Your account is not linked yet</h1>
      <p>
        You are signed in, but your account is not linked to an employee record, so there is nothing to show. Please ask HR to finish
        setting up your access.
      </p>
    </div>
  );
}
