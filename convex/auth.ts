import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { verificationEmail, passwordResetEmail } from "./services/email";
import { Value } from "convex/values";
import { isInternalAdminEmail } from "./adminAuth";

const FROM = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";

function generateOTP(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const code = (bytes[0] % 900000) + 100000;
  return String(code);
}

async function sendResendEmail(
  to: string,
  apiKey: string,
  from: string,
  email: { subject: string; html: string; text: string },
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject: email.subject, html: email.html, text: email.text }),
  });
  if (!res.ok) {
    throw new Error("Resend error: " + JSON.stringify(await res.json()));
  }
}

const ResendVerifyProvider = Resend({
  from: FROM,
  apiKey: process.env.AUTH_RESEND_KEY,
  generateVerificationToken: generateOTP,
  async sendVerificationRequest({ identifier: to, token, provider }) {
    await sendResendEmail(to, provider.apiKey!, provider.from!, verificationEmail({ code: token, email: to }));
  },
});

const ResendResetProvider = Resend({
  from: FROM,
  apiKey: process.env.AUTH_RESEND_KEY,
  generateVerificationToken: generateOTP,
  async sendVerificationRequest({ identifier: to, token, provider }) {
    await sendResendEmail(to, provider.apiKey!, provider.from!, passwordResetEmail({ code: token, email: to }));
  },
});

const AdminEmailProvider = Email({
  id: "admin-email",
  name: "Admin Email",
  from: FROM,
  maxAge: 10 * 60,
  generateVerificationToken: generateOTP,
  async authorize(params: any, account: any) {
    // The invite gate lives in the `afterUserCreatedOrUpdated` callback (it needs
    // database access to check workspace invitations). Here we only bind the code
    // to the address that requested it.
    const email = params.email;
    if (typeof email !== "string" || account.providerAccountId !== email.trim().toLowerCase()) {
      throw new Error("Invalid admin verification code.");
    }
  },
  async sendVerificationRequest({ identifier: to, token, provider }: any) {
    await sendResendEmail(to, provider.apiKey!, provider.from!, verificationEmail({ code: token, email: to }));
  },
  apiKey: process.env.AUTH_RESEND_KEY,
} as any);

// Build providers array - only include Google OAuth if real credentials are configured.
// This prevents hitting Google with a literal "placeholder" string in dev/missing-env scenarios.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_OAUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

if (!GOOGLE_OAUTH_ENABLED) {
  console.warn("[auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set - Google sign-in is DISABLED. Users can still sign in with email/password.");
}

// Current Terms / Privacy Policy version. Bump this string when the policy
// materially changes; clients should then re-prompt users to accept.
const TERMS_VERSION = "2026-05-06";

const providers: any[] = [
  AdminEmailProvider,
  Password({
    verify: ResendVerifyProvider,
    reset: ResendResetProvider,
    /**
     * Reads extra params passed to `signIn("password", { ..., name, acceptTerms })`
     * during the `signUp` flow and writes them onto the user row at creation.
     * Only runs at signup; subsequent signIn calls do not invoke this.
     */
    profile(params) {
      const out: Record<string, Value> & { email: string } = {
        email: params.email as string,
      };

      if (typeof params.name === "string" && params.name.trim()) {
        out.name = params.name.trim();
      }

      if (params.acceptTerms) {
        out.termsAcceptedAt = Date.now();
        out.termsVersion = TERMS_VERSION;
      }

      return out;
    },
  }),
];

if (GOOGLE_OAUTH_ENABLED) {
  providers.push(
    Google({
      clientId: GOOGLE_CLIENT_ID!,
      clientSecret: GOOGLE_CLIENT_SECRET!,
      // Explicitly map Google userinfo onto the users row so name + profile
      // picture are reliably persisted at first sign-in. Returning these
      // fields tells Convex Auth to write/refresh them on the user record.
      profile(googleProfile) {
        return {
          id: googleProfile.sub as string,
          email: googleProfile.email as string,
          name: googleProfile.name as string | undefined,
          image: googleProfile.picture as string | undefined,
        };
      },
    })
  );
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
  callbacks: {
    // Website workspace invite gate. Only the "admin-email" provider (used by
    // sirz.ai/admin) enforces workspace membership; all other providers
    // (password, google, clerk) are unaffected.
    async afterUserCreatedOrUpdated(ctx, args) {
      if (args.provider.id !== "admin-email") return;

      const db = ctx.db as any;
      const email =
        typeof args.profile.email === "string"
          ? args.profile.email.trim().toLowerCase()
          : "";
      if (!email) {
        throw new Error("A work email is required to access this workspace");
      }

      const now = Date.now();
      const isOwner = isInternalAdminEmail(email);
      const existing = await db
        .query("workspaceMembers")
        .withIndex("by_email", (q: any) => q.eq("email", email))
        .unique();
      const invitation = (await db
        .query("workspaceInvitations")
        .withIndex("by_email", (q: any) => q.eq("email", email))
        .collect())
        .find((item: any) => !item.acceptedAt && !item.revokedAt && item.expiresAt > now);

      if (!isOwner && existing?.status !== "active" && !invitation) {
        throw new Error("This email has not been invited to the SIRz website workspace");
      }
      if (existing?.status === "suspended" && !invitation && !isOwner) {
        throw new Error("Your website workspace access has been suspended");
      }

      // A code request only proves the address was typed. Activate the owner or
      // an invitation only after that address has verified its code.
      if (args.type !== "verification") return;

      if (invitation) {
        if (existing) {
          await db.patch(existing._id, {
            userId: args.userId,
            name: invitation.name || existing.name,
            role: invitation.role,
            status: "active",
            invitedBy: invitation.invitedBy,
            invitedAt: invitation._creationTime,
            joinedAt: now,
            suspendedAt: undefined,
          });
        } else {
          await db.insert("workspaceMembers", {
            userId: args.userId,
            email,
            name: invitation.name || email,
            role: invitation.role,
            status: "active",
            invitedBy: invitation.invitedBy,
            invitedAt: invitation._creationTime,
            joinedAt: now,
          });
        }
        await db.patch(invitation._id, { acceptedAt: now });
        return;
      }

      if (isOwner || existing?.status === "active") {
        if (existing) {
          await db.patch(existing._id, {
            userId: args.userId,
            role: isOwner ? "owner" : existing.role,
            status: "active",
            joinedAt: existing.joinedAt ?? now,
            suspendedAt: undefined,
          });
        } else {
          await db.insert("workspaceMembers", {
            userId: args.userId,
            email,
            name: args.profile.name || email,
            role: "owner",
            status: "active",
            invitedAt: now,
            joinedAt: now,
          });
        }
      }
    },
  },
});
