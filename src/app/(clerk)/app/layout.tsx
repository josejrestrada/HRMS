import Link from "next/link";
import { NavLink } from "./_components/nav-link";
import { UserButton } from "@clerk/nextjs";
import { getCurrentActor } from "@/shared/auth";

const icon = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const nav = [
  {
    label: "Dashboard",
    href: "/app",
    svg: (
      <svg {...icon}>
        <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
        <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
        <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    label: "My home",
    href: "/app/me",
    hrOnly: true,
    svg: (
      <svg {...icon}>
        <path d="M3.5 11 12 4l8.5 7" />
        <path d="M5.5 10v9.5h13V10" />
        <path d="M10 19.5v-5h4v5" />
      </svg>
    ),
  },
  {
    label: "People",
    href: "/app/people",
    svg: (
      <svg {...icon}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c2 .7 3.5 2.6 3.5 5.6" />
      </svg>
    ),
  },
  {
    label: "Leave",
    href: "/app/leave",
    svg: (
      <svg {...icon}>
        <path d="M4 20c0-9 6-15 16-16 0 10-6 16-16 16Z" />
        <path d="M4 20c3-5 6.5-8.5 11-11" />
      </svg>
    ),
  },
  {
    label: "Attendance",
    href: "/app/attendance",
    svg: (
      <svg {...icon}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Assistant",
    href: "/app/assistant",
    svg: (
      <svg {...icon}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5Z" />
        <path d="M8.5 8.5h7M8.5 11.5h4" />
      </svg>
    ),
  },
  {
    label: "Reports",
    href: "/app/reports",
    hrOnly: true,
    svg: (
      <svg {...icon}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Link className="brand" href="/app">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={32} height={32} />
          <span className="brand-name">Konkan Coastal Foods HRMS</span>
        </Link>
        <div className="app-user">
          {actor ? <span className="app-user-name">{actor.fullName}</span> : null}
          <UserButton />
        </div>
      </header>
      <div className="app-body">
        {actor ? (
          <nav className="app-nav" aria-label="Main">
            <ul>
              {nav
                .filter((item) => (item.label !== "People" && !("hrOnly" in item)) || actor.roles.includes("hr_admin"))
                .map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <NavLink href={item.href} exact={item.href === "/app"}>
                      {item.svg}
                      {item.label}
                    </NavLink>
                  ) : (
                    <span className="nav-link nav-soon" aria-disabled="true">
                      {item.svg}
                      {item.label}
                      <span className="chip">Soon</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <main id="main" className="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
