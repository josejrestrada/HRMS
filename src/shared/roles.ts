export type Role = "employee" | "hr_admin" | "system_admin";

/** The signed-in person, loaded from the database on every request (decision P2). */
export type Actor = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  roles: Role[];
};

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws unless the actor holds at least one of the allowed roles. */
export function requireRole(actor: Actor | null | undefined, ...allowed: Role[]): asserts actor is Actor {
  if (!actor || !allowed.some((role) => actor.roles.includes(role))) {
    throw new ForbiddenError();
  }
}
