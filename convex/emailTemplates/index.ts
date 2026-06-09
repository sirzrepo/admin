"use node";

import { Resend } from "resend";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { generateEmail } from "../helpers/generateEmail";
const fromEmail = "Rekobo <admin@rekobo.store>";

export const sendInviteEmail = action({
  args: {
    email: v.string(),
    token: v.string(),
    invitedBy: v.string(),
    expiresAt: v.number(),
  },

  handler: async (_, args) => {
    const resend = new Resend(process.env.AUTH_RESEND_KEY);

    const result = generateEmail({
        type: "invite",
        email: args.email,
        subject: `You're invited to join Sirz Admin Panel`,
        token: args.token,
        expires: args.expiresAt,
        businessName: "Sirz",
        message: `Hi there! ${args.invitedBy} has invited you to join Sirz Admin Panel.`,
        disclaimer: "If you did not expect this invitation, please ignore this email.",
    });

    const { error } = await resend.emails.send(result);

    if (error) {
      console.error(error);
    }

    console.log(result);
  },
});