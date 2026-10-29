import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <Link className="auth-brand" href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={40} height={40} />
        <span>Konkan Coastal Foods HRMS</span>
      </Link>
      <SignIn />
    </main>
  );
}
