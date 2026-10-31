import Link from "next/link";
import { formatDate, tenureText } from "@/shared/dates";
import type { EmployeeProfile, PeopleLookups } from "@/modules/employees/data";
import type { PersonalDetails } from "@/modules/employees/personal";
import type { EmployeeLeaveView } from "@/modules/leave/data";
import type { EmployeeMonth } from "@/modules/attendance/data";
import { Avatar, TYPE_LABELS, displayName, plural } from "../../_components/ui";
import { changeAssignmentAction, deactivateEmployeeAction, reactivateEmployeeAction } from "../actions";
import { EmployeeForm } from "./employee-form";
import { PersonalForm } from "../../_components/personal-form";
import type { BankDetails } from "@/modules/employees/bank";
import { BankForm } from "./bank-form";
import { ProfileAttendance, ProfileLeave } from "./profile-leave-attendance";

const SOON_TABS = ["Documents"];

export function ProfileView(props: {
  profile: EmployeeProfile;
  lookups: PeopleLookups | null;
  tab: "overview" | "history" | "personal" | "bank" | "leave" | "attendance";
  personal?: PersonalDetails;
  bank?: BankDetails;
  leave?: EmployeeLeaveView;
  month?: EmployeeMonth;
  form?: string;
  error?: string;
  saved?: string;
  actorEmployeeId: string;
  today: string;
}) {
  const { profile, lookups, tab, form, error, saved, today } = props;
  const cur = profile.current;
  const active = profile.status === "active";
  const isSelf = profile.id === props.actorEmployeeId;
  const base = `/app/people/${profile.id}`;

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/app/people">People</Link> / {displayName(profile.fullName)}
        </p>
      </div>

      {saved ? (
        <div className="alert alert-ok" role="status">
          {saved}
        </div>
      ) : null}
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="profile-head panel">
        <Avatar name={profile.fullName} large />
        <div className="profile-id">
          <h1>{displayName(profile.fullName)}</h1>
          <p className="muted">
            {profile.code}
            {cur ? ` · ${cur.designation}, ${cur.department} · ${cur.location}` : " · No current assignment"}
          </p>
          <p className="chips">
            <span className={active ? "chip chip-ok" : "chip"}>{active ? "Active" : "Inactive"}</span>
            <span className="chip">{profile.signedIn ? "Signed in" : "Not signed in"}</span>
            {profile.roles.includes("hr_admin") ? <span className="chip">HR admin</span> : null}
            {cur ? <span className="chip">{TYPE_LABELS[cur.employmentType] ?? cur.employmentType}</span> : null}
          </p>
        </div>
        <div className="profile-actions">
          {active ? (
            <>
              <Link className="btn btn-primary btn-small" href={`${base}?form=change`} scroll={false}>
                Change assignment
              </Link>
              {!isSelf ? (
                <Link className="btn btn-secondary btn-small" href={`${base}?form=deactivate`} scroll={false}>
                  Deactivate
                </Link>
              ) : null}
            </>
          ) : (
            <form action={reactivateEmployeeAction}>
              <input type="hidden" name="employeeId" value={profile.id} />
              <button type="submit" className="btn btn-primary btn-small">
                Reactivate
              </button>
            </form>
          )}
        </div>
      </section>

      {form === "change" && active && lookups ? (
        <section className="panel panel-form" aria-label="Change assignment">
          <h2 className="panel-title">Change assignment</h2>
          <EmployeeForm
            mode="change"
            action={changeAssignmentAction}
            lookups={lookups}
            employeeId={profile.id}
            cancelHref={base}
            defaults={{
              effectiveFrom: today,
              locationId: cur?.locationId ?? "",
              department: cur?.department ?? "",
              designation: cur?.designation ?? "",
              employmentType: cur?.employmentType ?? "",
              managerId: profile.managerId ?? "",
            }}
          />
        </section>
      ) : null}

      {form === "deactivate" && active && !isSelf ? (
        <section className="panel panel-form" aria-label="Deactivate employee">
          <h2 className="panel-title">Deactivate {displayName(profile.fullName)}</h2>
          <p className="muted">
            They will lose access to the system. Their record and history are kept, and you can reactivate them later.
          </p>
          <form action={deactivateEmployeeAction} className="form">
            <input type="hidden" name="employeeId" value={profile.id} />
            <div className="field">
              <label htmlFor="exitDate">
                Last working day<span className="req"> *</span>
              </label>
              <input id="exitDate" name="exitDate" type="date" defaultValue={today} required />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-danger btn-small">
                Deactivate employee
              </button>
              <Link className="btn btn-secondary btn-small" href={base}>
                Cancel
              </Link>
            </div>
          </form>
        </section>
      ) : null}

      <nav className="tabs" aria-label="Profile sections">
        <Link href={base} className={tab === "overview" ? "tab tab-current" : "tab"} aria-current={tab === "overview" ? "page" : undefined}>
          Overview
        </Link>
        <Link href={`${base}?tab=history`} className={tab === "history" ? "tab tab-current" : "tab"} aria-current={tab === "history" ? "page" : undefined}>
          History
        </Link>
        {(
          [
            ["personal", "Personal"],
            ["bank", "Bank and salary"],
            ["leave", "Leave"],
            ["attendance", "Attendance"],
          ] as const
        ).map(([key, label]) => (
          <Link key={key} href={`${base}?tab=${key}`} className={tab === key ? "tab tab-current" : "tab"} aria-current={tab === key ? "page" : undefined}>
            {label}
          </Link>
        ))}
        {SOON_TABS.map((t) => (
          <span key={t} className="tab tab-soon" aria-disabled="true">
            {t} <span className="chip">Soon</span>
          </span>
        ))}
      </nav>

      {tab === "personal" && props.personal ? (
        <>
          <section className="panel" aria-labelledby="p-basic-tab">
            <div className="panel-head">
              <h2 id="p-basic-tab">Basic details</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Full name</dt>
                <dd>{displayName(profile.fullName)}</dd>
              </div>
              <div>
                <dt>Work email</dt>
                <dd>{profile.workEmail}</dd>
              </div>
              <div>
                <dt>Gender</dt>
                <dd>{profile.gender ? profile.gender[0].toUpperCase() + profile.gender.slice(1) : "Not stated"}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{profile.dateOfBirth ? formatDate(profile.dateOfBirth) : "Not stated"}</dd>
              </div>
            </dl>
          </section>
          <section className="panel panel-form" aria-labelledby="p-statutory">
            <div className="panel-head">
              <h2 id="p-statutory">PAN and Aadhaar</h2>
            </div>
            <PersonalForm details={props.personal} isHr />
          </section>
        </>
      ) : null}

      {tab === "bank" && props.bank ? (
        <section className="panel panel-form" aria-labelledby="p-bank">
          <div className="panel-head">
            <h2 id="p-bank">Bank and salary</h2>
          </div>
          <BankForm details={props.bank} />
        </section>
      ) : null}

      {tab === "leave" && props.leave ? <ProfileLeave data={props.leave} /> : null}
      {tab === "attendance" && props.month ? <ProfileAttendance data={props.month} base={base} /> : null}

      {tab === "overview" ? (
        <div className="two-col">
          <section className="panel" aria-labelledby="p-employment">
            <div className="panel-head">
              <h2 id="p-employment">Employment</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Department</dt>
                <dd>{cur?.department ?? "–"}</dd>
              </div>
              <div>
                <dt>Designation</dt>
                <dd>{cur?.designation ?? "–"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{cur?.location ?? "–"}</dd>
              </div>
              <div>
                <dt>Employment type</dt>
                <dd>{cur ? (TYPE_LABELS[cur.employmentType] ?? cur.employmentType) : "–"}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>
                  {formatDate(profile.joiningDate)}
                  <span className="sub">{active ? tenureText(profile.joiningDate, today) : `Left ${profile.exitDate ? formatDate(profile.exitDate) : ""}`}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="p-reporting">
            <div className="panel-head">
              <h2 id="p-reporting">Reporting</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Manager</dt>
                <dd>
                  {profile.managerId && cur?.managerName ? (
                    <Link href={`/app/people/${profile.managerId}`}>{displayName(cur.managerName)}</Link>
                  ) : (
                    "No manager"
                  )}
                </dd>
              </div>
              <div>
                <dt>Direct reports</dt>
                <dd>
                  {profile.directReports.length === 0 ? (
                    "None"
                  ) : (
                    <>
                      {plural(profile.directReports.length, "person", "people")}
                      <ul className="plain-links">
                        {profile.directReports.map((r) => (
                          <li key={r.id}>
                            <Link href={`/app/people/${r.id}`}>{displayName(r.fullName)}</Link>
                            <span className="sub">{r.designation}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="p-basic">
            <div className="panel-head">
              <h2 id="p-basic">Basic details</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Work email</dt>
                <dd>{profile.workEmail}</dd>
              </div>
              <div>
                <dt>Gender</dt>
                <dd>{profile.gender ? profile.gender[0].toUpperCase() + profile.gender.slice(1) : "Not stated"}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{profile.dateOfBirth ? formatDate(profile.dateOfBirth) : "Not stated"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="p-account">
            <div className="panel-head">
              <h2 id="p-account">Sign-in account</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Status</dt>
                <dd>{profile.signedIn ? "Signed in and linked" : "Not signed in yet"}</dd>
              </div>
              <div>
                <dt>Roles</dt>
                <dd>{["Employee", ...profile.roles.map((r) => (r === "hr_admin" ? "HR admin" : "System admin"))].join(", ")}</dd>
              </div>
            </dl>
            {!profile.signedIn ? (
              <p className="hint">They are linked automatically the first time they sign in with the work email above.</p>
            ) : null}
          </section>
        </div>
      ) : (
        <section className="panel" aria-labelledby="p-history">
          <div className="panel-head">
            <h2 id="p-history">Assignment history</h2>
            <span className="muted">{plural(profile.history.length, "entry", "entries")}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Designation</th>
                  <th scope="col">Department</th>
                  <th scope="col">Location</th>
                  <th scope="col">Type</th>
                  <th scope="col">Manager</th>
                </tr>
              </thead>
              <tbody>
                {profile.history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.effectiveFrom)}</td>
                    <td>{h.effectiveTo ? formatDate(h.effectiveTo) : <span className="chip chip-ok">Current</span>}</td>
                    <td>{h.designation}</td>
                    <td>{h.department}</td>
                    <td>{h.location}</td>
                    <td>{TYPE_LABELS[h.employmentType] ?? h.employmentType}</td>
                    <td>{h.managerName ? displayName(h.managerName) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
