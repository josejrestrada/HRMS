# Konkan Coastal Foods HRMS

HR system for Konkan Coastal Foods (180 employees; head office in Panaji, plant in Verna, Goa). It covers Employee Master, Attendance, Leave and an HR assistant agent.

## Stack
Next.js on Vercel, Supabase, Clerk, Resend for email, Gemini/Groq for the agent.

## Rules
- Business rules are in `RESEARCH.md` and `docs/requirements.pdf`. Follow them exactly.
- All dates and times are in IST (Asia/Kolkata).
- Every role check happens on the server, not just by hiding buttons.
- Never show Aadhaar, PAN or bank details unmasked. Never store the full Aadhaar number (last 4 digits only).
- All database access goes through each module's data-access layer, which requires the acting user. Never import the database client in routes, server actions or components.
- Roles come from the database, never from Clerk token claims.
- Never commit secrets or `.env` files.
- Follow `ARCHITECTURE.md` and `DESIGN.md`. If something must change, update the decision log first.
- Do not reset the database or run destructive commands without asking me.

## Code layout
Organise code by module: `employees`, `attendance`, `leave`, `reports`, `agent`.
