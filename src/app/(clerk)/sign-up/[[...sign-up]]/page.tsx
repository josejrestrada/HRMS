import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <Link className="auth-brand" href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={40} height={40} />
        <span>Konkan Coastal Foods HRMS</span>
      </Link>
      <p className="auth-note">Creating an account needs an invitation from HR.</p>
      <SignUp />
    </main>
  );
}
