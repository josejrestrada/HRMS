/**
 * Who may approve or reject a request from another employee (R20, R31). Shared by leave, comp-off
 * and attendance regularization so the rule exists in exactly one place.
 */
export function canDecide(p: {
  actorEmployeeId: string;
  actorIsHrAdmin: boolean;
  actorIsManagerOfRequester: boolean;
  requesterEmployeeId: string;
}): boolean {
  if (p.actorEmployeeId === p.requesterEmployeeId) return false;
  return p.actorIsHrAdmin || p.actorIsManagerOfRequester;
}
