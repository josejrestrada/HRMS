import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk only runs on the auth pages and the signed-in app, so the public
// landing page never depends on Clerk keys.
export default clerkMiddleware(
  async (auth, req) => {
    if (req.nextUrl.pathname.startsWith("/app")) {
      await auth.protect();
    }
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: ["/sign-in(.*)", "/sign-up(.*)", "/app(.*)"],
};
