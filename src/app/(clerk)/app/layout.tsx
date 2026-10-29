import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { getCurrentActor } from "@/shared/auth";

const nav = [
  { label: "Dashboard", href: "/app" },
  { label: "People", soon: true },
  { label: "Leave", soon: true },
  { label: "Attendance", soon: true },
  { label: "Reports", soon: true },
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
              {nav.map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <Link href={item.href} aria-current="page" className="nav-link nav-current">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="nav-link nav-soon" aria-disabled="true">
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
