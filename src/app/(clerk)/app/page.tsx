import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

// Placeholder signed-in page. Until the account is linked to an employee record
// (decision P2), a signed-in user sees no data, only this message.
// The check happens here on the server as well as in proxy.ts: the proxy is only
// an early redirect, not the access control.
export default async function AppHomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="auth-page">
      <div className="signed-in-card">
        <UserButton />
        <h1>You are signed in</h1>
        <p>
          Your account is not linked to an employee record yet, so there is nothing to show. Please
          ask HR to finish setting up your access.
        </p>
      </div>
    </main>
  );
}
