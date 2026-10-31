import type { ReactNode } from "react";
import Link from "next/link";

type Module = { name: string; description: string; icon: ReactNode };

const iconProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const modules: Module[] = [
  {
    name: "Employee Master",
    description:
      "One record per person: job details, reporting lines and an employee code that never changes. Sensitive IDs stay masked.",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M17 6.5h4.5M17 10h4.5" />
      </svg>
    ),
  },
  {
    name: "Attendance",
    description:
      "Daily punches turned into a clear monthly view, with easy fixes for missed punches and work-from-home days.",
    icon: (
      <svg {...iconProps}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    ),
  },
  {
    name: "Leave",
    description:
      "Apply, approve and track leave with a balance you can always explain, plus holidays for your own location.",
    icon: (
      <svg {...iconProps}>
        <path d="M4 20c0-9 6-15 16-16 0 10-6 16-16 16Z" />
        <path d="M4 20c3-5 6.5-8.5 11-11" />
      </svg>
    ),
  },
  {
    name: "HR Assistant",
    description:
      "Ask questions about your leave balance, holidays and policies in plain language, and get answers based on your own access.",
    icon: (
      <svg {...iconProps}>
        <path d="M20.5 12a8 8 0 0 1-11.7 7.1L3.5 20.5l1.4-4.9A8 8 0 1 1 20.5 12Z" />
        <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
      </svg>
    ),
  },
];

export default function HomePage() {
  const year = new Date().getFullYear();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span className="brand-name">Konkan Coastal Foods HRMS</span>
          </div>
          <Link className="btn btn-primary" href="/sign-in">
            Sign in
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="container hero-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="hero-logo"
              src="/logo.svg"
              alt="Konkan Coastal Foods logo"
              width={96}
              height={96}
            />
            <h1>People operations for Konkan Coastal Foods</h1>
            <p className="lead">
              Employee records, attendance and leave in one place, for the Panaji head office, the Verna plant
              and people across Goa.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/sign-in">
                Sign in
              </Link>
              <Link className="btn btn-secondary" href="/sign-up">
                Create account
              </Link>
            </div>
          </div>
        </section>

        <section className="modules" aria-labelledby="modules-heading">
          <div className="container">
            <h2 id="modules-heading">What is coming</h2>
            <ul className="module-grid">
              {modules.map((m) => (
                <li key={m.name} className="card">
                  <div className="card-icon">{m.icon}</div>
                  <div className="card-head">
                    <h3>{m.name}</h3>
                    <span className="chip">Planned</span>
                  </div>
                  <p>{m.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>&copy; {year} Konkan Coastal Foods, Goa.</p>
        </div>
      </footer>
    </>
  );
}
