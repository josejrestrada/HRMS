// Seeds clearly fake TEST data plus one HR admin, so the dashboard has something to show.
// Refuses to run unless ALLOW_SEED=yes. Never deletes anything. Usage:
//   ALLOW_SEED=yes npm run db:seed        (HR_ADMIN_EMAIL must be set in .env.local)
import { Pool } from "@neondatabase/serverless";

if (process.env.ALLOW_SEED !== "yes") {
  console.error("Refusing to seed: set ALLOW_SEED=yes to confirm this is test data for a dev database.");
  process.exit(1);
}
const adminEmail = (process.env.HR_ADMIN_EMAIL || "").trim().toLowerCase();
if (!adminEmail.includes("@")) {
  console.error("Set HR_ADMIN_EMAIL in .env.local to the email you sign in with.");
  process.exit(1);
}

const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const today = istDate.format(new Date());
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const people = [
  // [name, location, department, designation, type, joinedDaysAgo, managerIndex (into this list) or null]
  ["Asha Naik", "PNJ", "Finance", "Finance Manager", "permanent", 2100, null],
  ["Rohan Kamat", "PNJ", "Sales", "Sales Manager", "permanent", 1800, null],
  ["Meera Fernandes", "VRN", "Production", "Plant Manager", "permanent", 2500, null],
  ["Vikram Dessai", "VRN", "Quality", "Quality Lead", "permanent", 1500, 2],
  ["Priya Borkar", "VRN", "Production", "Shift Supervisor", "permanent", 1200, 2],
  ["Sanjay Gaonkar", "VRN", "Production", "Machine Operator", "permanent", 900, 4],
  ["Neha Prabhu", "VRN", "Production", "Machine Operator", "permanent", 700, 4],
  ["Joao Dias", "VRN", "Logistics", "Dispatch Coordinator", "permanent", 650, 2],
  ["Kavita Shirodkar", "PNJ", "Finance", "Accounts Executive", "permanent", 600, 0],
  ["Rahul Volvoikar", "PNJ", "Sales", "Sales Executive", "permanent", 500, 1],
  ["Sneha Pednekar", "PNJ", "Sales", "Sales Executive", "permanent", 420, 1],
  ["Anil Sawant", "VRN", "Production", "Machine Operator", "contract", 300, 4],
  ["Divya Rane", "VRN", "Quality", "Lab Technician", "permanent", 280, 3],
  ["Carlos Pereira", "VRN", "Logistics", "Driver", "contract", 240, 7],
  ["Deepa Kerkar", "PNJ", "Finance", "Payroll Executive", "permanent", 200, 0],
  ["Nikhil Mhambre", "VRN", "Production", "Machine Operator", "probation", 90, 4],
  ["Pooja Chodankar", "PNJ", "Sales", "Marketing Executive", "probation", 70, 1],
  ["Imran Shaikh", "VRN", "Quality", "Lab Technician", "probation", 55, 3],
  ["Tanvi Gawas", "PNJ", "Finance", "Accounts Intern", "intern", 40, 0],
  ["Rutuja Salgaonkar", "VRN", "Production", "Machine Operator", "permanent", 25, 4],
  ["Amit Bandekar", "PNJ", "Sales", "Sales Executive", "permanent", 14, 1],
  ["Sheetal Mapari", "VRN", "Logistics", "Store Keeper", "permanent", 6, 7],
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const exists = await client.query("select 1 from employee where work_email like '%@example.invalid' limit 1");
  if (exists.rowCount) {
    console.log("Test data already present, nothing to do.");
    process.exit(0);
  }
  await client.query("begin");

  const loc = Object.fromEntries((await client.query("select code, id from location")).rows.map((r) => [r.code, r.id]));
  const lt = Object.fromEntries((await client.query("select code, id from leave_type")).rows.map((r) => [r.code, r.id]));

  async function addEmployee(name, email, joined, gender) {
    const r = await client.query(
      "insert into employee (full_name, work_email, joining_date, gender) values ($1, $2, $3, $4) returning id",
      [name, email, joined, gender],
    );
    return r.rows[0].id;
  }
  async function assign(empId, locCode, dept, desig, type, from, managerId) {
    await client.query(
      `insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [empId, loc[locCode], dept, desig, managerId, type, from],
    );
  }

  // HR admin: the person who signs in. Name and details are placeholders.
  const adminJoined = addDays(today, -1000);
  const adminId = await addEmployee("TEST HR Administrator", adminEmail, adminJoined, null);
  await assign(adminId, "PNJ", "Human Resources", "HR Administrator", "permanent", adminJoined, null);
  await client.query("insert into employee_role (employee_id, role) values ($1, 'hr_admin')", [adminId]);

  const ids = [];
  for (let i = 0; i < people.length; i++) {
    const [name, l, dept, desig, type, ago, mgr] = people[i];
    const joined = addDays(today, -ago);
    const id = await addEmployee(`TEST ${name}`, `test.${i + 1}@example.invalid`, joined, i % 2 ? "female" : "male");
    ids.push(id);
    await assign(id, l, dept, desig, type, joined, mgr === null ? null : ids[mgr]);
  }

  // Leave: three approved covering today, four pending of different ages.
  const leave = async (idx, code, startOff, endOff, status, createdAgo, days) => {
    await client.query(
      `insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, reason, status, approver_id, decided_at, created_at)
       values ($1, $2, $3, $4, $5, 'Test data', $6, $7, $8, now() - ($9 || ' days')::interval)`,
      [ids[idx], lt[code], addDays(today, startOff), addDays(today, endOff), days, status,
       status === "approved" ? adminId : null, status === "approved" ? new Date() : null, String(createdAgo)],
    );
  };
  await leave(5, "SL", -1, 1, "approved", 3, 3);
  await leave(9, "CL", 0, 0, "approved", 2, 1);
  await leave(14, "EL", -2, 3, "approved", 8, 6);
  await leave(6, "CL", 4, 5, "pending", 1, 2);
  await leave(10, "EL", 10, 14, "pending", 4, 5);
  await leave(12, "SL", 1, 1, "pending", 0, 1);
  await leave(17, "CL", 7, 7, "pending", 6, 1);

  // Attendance for today: most recorded, a few not yet.
  const statuses = ["present", "present", "present", "present", "present", "wfh", "present", "present", "half_day", "present"];
  for (let i = 0; i < ids.length; i++) {
    if (i % 7 === 6) continue; // not recorded yet
    let status = statuses[i % statuses.length];
    if ([5, 9, 14].includes(i)) status = "leave";
    if (i === 11) status = "absent";
    await client.query("insert into attendance_day (employee_id, work_date, status) values ($1, $2, $3)", [ids[i], today, status]);
  }

  await client.query("commit");
  console.log(`Seeded 1 HR admin and ${ids.length} TEST employees (all @example.invalid), as of ${today} IST.`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
