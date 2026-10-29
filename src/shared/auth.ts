import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { findActorByClerkUserId, linkActorByVerifiedEmail } from "@/modules/employees/data";
import type { Actor } from "./roles";

/**
 * The current signed-in employee, or null. Clerk proves identity only; the employee row and
 * roles always come from the database, never from token claims (decision P2).
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await findActorByClerkUserId(userId);
  if (existing) return existing;

  const user = await currentUser();
  const email = user?.primaryEmailAddress;
  if (!email || email.verification?.status !== "verified") return null;
  return linkActorByVerifiedEmail(userId, email.emailAddress);
});
