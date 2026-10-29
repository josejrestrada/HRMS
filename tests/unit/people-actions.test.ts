import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
const actorMock = vi.fn();
vi.mock("@/shared/auth", () => ({ getCurrentActor: () => actorMock() }));
const createMock = vi.fn();
const changeMock = vi.fn();
const deactivateMock = vi.fn();
const reactivateMock = vi.fn();
vi.mock("@/modules/employees/data", () => ({
  createEmployee: (...a: unknown[]) => createMock(...a),
  changeAssignment: (...a: unknown[]) => changeMock(...a),
  deactivateEmployee: (...a: unknown[]) => deactivateMock(...a),
  reactivateEmployee: (...a: unknown[]) => reactivateMock(...a),
}));

import { changeAssignmentAction, createEmployeeAction, deactivateEmployeeAction, reactivateEmployeeAction } from "@/app/(clerk)/app/people/actions";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";

const hr: Actor = { employeeId: "hr", employeeCode: "KCF0001", fullName: "HR", roles: ["employee", "hr_admin"] };
const employee: Actor = { employeeId: "e", employeeCode: "KCF0002", fullName: "E", roles: ["employee"] };
const id = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const goodNew = { fullName: "Asha Naik", workEmail: "a@example.invalid", joiningDate: "2026-10-01", locationId: id, department: "D", designation: "E", employmentType: "permanent", managerId: "", gender: "", dateOfBirth: "" };

beforeEach(() => {
  [actorMock, createMock, changeMock, deactivateMock, reactivateMock].forEach((m) => m.mockReset());
});

describe("actions refuse anyone who is not an HR admin", () => {
  it.each([
    ["createEmployeeAction", () => createEmployeeAction({}, form(goodNew))],
    ["changeAssignmentAction", () => changeAssignmentAction({}, form({ employeeId: id }))],
    ["deactivateEmployeeAction", () => deactivateEmployeeAction(form({ employeeId: id, exitDate: "2026-10-30" }))],
    ["reactivateEmployeeAction", () => reactivateEmployeeAction(form({ employeeId: id }))],
  ])("%s", async (_n, run) => {
    for (const actor of [null, employee]) {
      actorMock.mockResolvedValue(actor);
      await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(createMock).not.toHaveBeenCalled();
    expect(changeMock).not.toHaveBeenCalled();
    expect(deactivateMock).not.toHaveBeenCalled();
    expect(reactivateMock).not.toHaveBeenCalled();
  });
});

describe("createEmployeeAction", () => {
  it("returns a plain message and the typed values for a bad email, without saving", async () => {
    actorMock.mockResolvedValue(hr);
    const state = await createEmployeeAction({}, form({ ...goodNew, workEmail: "oops" }));
    expect(state.error).toBe("Enter a valid email address");
    expect(state.field).toBe("workEmail");
    expect(state.values?.fullName).toBe("Asha Naik");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns a domain error to the form", async () => {
    actorMock.mockResolvedValue(hr);
    createMock.mockRejectedValue(new DomainError("An employee with this work email already exists.", "workEmail"));
    const state = await createEmployeeAction({}, form(goodNew));
    expect(state.field).toBe("workEmail");
    expect(state.error).toContain("already exists");
  });

  it("does not hide unexpected errors", async () => {
    actorMock.mockResolvedValue(hr);
    createMock.mockRejectedValue(new Error("database down"));
    await expect(createEmployeeAction({}, form(goodNew))).rejects.toThrow("database down");
  });

  it("redirects to the new profile on success", async () => {
    actorMock.mockResolvedValue(hr);
    createMock.mockResolvedValue({ id, employeeCode: "KCF0099" });
    await expect(createEmployeeAction({}, form(goodNew))).rejects.toThrow(`REDIRECT:/app/people/${id}?saved=created`);
  });
});

describe("other actions", () => {
  it("sends a bad employee id back to the list", async () => {
    actorMock.mockResolvedValue(hr);
    await expect(reactivateEmployeeAction(form({ employeeId: "not-a-uuid" }))).rejects.toThrow("REDIRECT:/app/people");
    expect(reactivateMock).not.toHaveBeenCalled();
  });

  it("shows a domain error from deactivate on the profile", async () => {
    actorMock.mockResolvedValue(hr);
    deactivateMock.mockRejectedValue(new DomainError("You cannot deactivate your own account."));
    await expect(deactivateEmployeeAction(form({ employeeId: id, exitDate: "2026-10-30" }))).rejects.toThrow(/REDIRECT:\/app\/people\/.*error=You\+cannot\+deactivate/);
  });
});
