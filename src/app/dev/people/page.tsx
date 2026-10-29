import { notFound } from "next/navigation";
import type { EmployeeList, EmployeeProfile, PeopleLookups } from "@/modules/employees/data";
import { createEmployeeAction } from "../../(clerk)/app/people/actions";
import { EmployeeForm } from "../../(clerk)/app/people/_components/employee-form";
import { PeopleListView } from "../../(clerk)/app/people/_components/people-list-view";
import { ProfileView } from "../../(clerk)/app/people/_components/profile-view";

// Development-only design preview with made-up people. It reads no database and no session, and it
// returns 404 in production. Use ?view=list | profile | history | change | deactivate | new
const lookups: PeopleLookups = {
  locations: [
    { id: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f01", name: "Panaji" },
    { id: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f02", name: "Verna" },
  ],
  departments: ["Finance", "Human Resources", "Logistics", "Production", "Quality", "Sales"],
  managers: [
    { id: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f11", code: "KCF0003", fullName: "Meera Fernandes" },
    { id: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f12", code: "KCF0001", fullName: "Asha Naik" },
  ],
};

const rows: EmployeeList["rows"] = [
  { id: "a1", code: "KCF0001", fullName: "Asha Naik", workEmail: "asha@example.invalid", status: "active", signedIn: true, department: "Finance", designation: "Finance Manager", employmentType: "permanent", location: "Panaji", managerName: null },
  { id: "a2", code: "KCF0003", fullName: "Meera Fernandes", workEmail: "meera@example.invalid", status: "active", signedIn: true, department: "Production", designation: "Plant Manager", employmentType: "permanent", location: "Verna", managerName: null },
  { id: "a3", code: "KCF0006", fullName: "Sanjay Gaonkar", workEmail: "sanjay@example.invalid", status: "active", signedIn: false, department: "Production", designation: "Machine Operator", employmentType: "permanent", location: "Verna", managerName: "Priya Borkar" },
  { id: "a4", code: "KCF0016", fullName: "Nikhil Mhambre", workEmail: "nikhil@example.invalid", status: "active", signedIn: false, department: "Production", designation: "Machine Operator", employmentType: "probation", location: "Verna", managerName: "Priya Borkar" },
  { id: "a5", code: "KCF0014", fullName: "Carlos Pereira", workEmail: "carlos@example.invalid", status: "inactive", signedIn: false, department: "Logistics", designation: "Driver", employmentType: "contract", location: "Verna", managerName: "Joao Dias" },
];
const list: EmployeeList = { rows, total: 23, page: 1, pageSize: 20 };

const profile: EmployeeProfile = {
  id: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f21",
  code: "KCF0006",
  fullName: "Sanjay Gaonkar",
  workEmail: "sanjay@example.invalid",
  gender: "male",
  dateOfBirth: "1992-04-18",
  joiningDate: "2024-05-13",
  exitDate: null,
  status: "active",
  signedIn: false,
  roles: [],
  managerId: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f12",
  current: { id: "h2", locationId: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f02", location: "Verna", department: "Production", designation: "Machine Operator", employmentType: "permanent", managerName: "Priya Borkar", effectiveFrom: "2025-04-01", effectiveTo: null },
  directReports: [
    { id: "r1", code: "KCF0016", fullName: "Nikhil Mhambre", designation: "Trainee Operator" },
    { id: "r2", code: "KCF0020", fullName: "Rutuja Salgaonkar", designation: "Machine Operator" },
  ],
  history: [
    { id: "h2", locationId: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f02", location: "Verna", department: "Production", designation: "Machine Operator", employmentType: "permanent", managerName: "Priya Borkar", effectiveFrom: "2025-04-01", effectiveTo: null },
    { id: "h1", locationId: "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f02", location: "Verna", department: "Production", designation: "Trainee Operator", employmentType: "probation", managerName: "Priya Borkar", effectiveFrom: "2024-05-13", effectiveTo: "2025-03-31" },
  ],
};

export default async function PeoplePreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "list" } = await searchParams;

  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          {view === "new" ? (
            <section className="panel panel-form">
              <h1 className="panel-title">Add employee</h1>
              <EmployeeForm mode="create" action={createEmployeeAction} lookups={lookups} cancelHref="/dev/people" />
            </section>
          ) : view === "list" ? (
            <PeopleListView list={list} lookups={lookups} filter={{ status: "active", page: 1 }} />
          ) : (
            <ProfileView
              profile={profile}
              lookups={view === "change" ? lookups : null}
              tab={view === "history" ? "history" : "overview"}
              form={view === "change" ? "change" : view === "deactivate" ? "deactivate" : undefined}
              error={view === "deactivate" ? "2 active employees still report to this person. Give them a new manager first." : undefined}
              saved={view === "profile" ? "Employee added." : undefined}
              actorEmployeeId="someone-else"
              today="2026-10-30"
            />
          )}
        </main>
      </div>
    </div>
  );
}
