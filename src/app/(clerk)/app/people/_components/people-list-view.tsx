import Link from "next/link";
import type { EmployeeList, PeopleLookups } from "@/modules/employees/data";
import type { ListFilter } from "@/modules/employees/schemas";
import { Avatar, TYPE_LABELS, displayName, plural } from "../../_components/ui";

export function PeopleListView({ list, lookups, filter }: { list: EmployeeList; lookups: PeopleLookups; filter: ListFilter }) {
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const hasFilter = !!(filter.q || filter.location || filter.department || filter.status !== "active");
  const link = (page: number) => {
    const p = new URLSearchParams();
    if (filter.q) p.set("q", filter.q);
    if (filter.status !== "active") p.set("status", filter.status);
    if (filter.location) p.set("location", filter.location);
    if (filter.department) p.set("department", filter.department);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    return qs ? `/app/people?${qs}` : "/app/people";
  };

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>People</h1>
          <p className="muted">{plural(list.total, "employee", "employees")}{hasFilter ? " match your filters" : ""}</p>
        </div>
        <Link className="btn btn-primary btn-small" href="/app/people/new">
          Add employee
        </Link>
      </div>

      <form className="filters" method="get" action="/app/people" role="search" aria-label="Filter people">
        <div className="filter">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" type="search" placeholder="Name, code or email" defaultValue={filter.q ?? ""} />
        </div>
        <div className="filter">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filter.status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="filter">
          <label htmlFor="location">Location</label>
          <select id="location" name="location" defaultValue={filter.location ?? ""}>
            <option value="">All locations</option>
            {lookups.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter">
          <label htmlFor="department">Department</label>
          <select id="department" name="department" defaultValue={filter.department ?? ""}>
            <option value="">All departments</option>
            {lookups.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary btn-small">
            Apply
          </button>
          {hasFilter ? (
            <Link className="btn btn-secondary btn-small" href="/app/people">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <section className="panel" aria-label="Employees">
        {list.rows.length === 0 ? (
          <p className="empty">
            {hasFilter ? "No employees match these filters. Try clearing the search or choosing All." : "No employees yet. Add the first one."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Job</th>
                  <th scope="col">Location</th>
                  <th scope="col">Type</th>
                  <th scope="col">Manager</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Employee">
                      <Link className="person person-link" href={`/app/people/${p.id}`}>
                        <Avatar name={p.fullName} />
                        <span>
                          {displayName(p.fullName)}
                          <span className="sub">{p.code}</span>
                        </span>
                      </Link>
                    </td>
                    <td data-label="Job">
                      {p.designation ?? "Not assigned"}
                      <span className="sub">{p.department ?? ""}</span>
                    </td>
                    <td data-label="Location">{p.location ?? "–"}</td>
                    <td data-label="Type">{p.employmentType ? (TYPE_LABELS[p.employmentType] ?? p.employmentType) : "–"}</td>
                    <td data-label="Manager">{p.managerName ? displayName(p.managerName) : "–"}</td>
                    <td data-label="Status">
                      <span className={p.status === "active" ? "chip chip-ok" : "chip"}>{p.status === "active" ? "Active" : "Inactive"}</span>
                      <span className="sub">{p.signedIn ? "Signed in" : "Not signed in"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <nav className="pager" aria-label="Pages">
            {filter.page > 1 ? (
              <Link className="btn btn-secondary btn-small" href={link(filter.page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="muted">
              Page {filter.page} of {pages}
            </span>
            {filter.page < pages ? (
              <Link className="btn btn-secondary btn-small" href={link(filter.page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </>
  );
}
