// ─── SIRz Branded Email Template System ──────────────────────────────────────
// Reusable email templates for all transactional emails (verification, password
// reset, campaign notifications, etc.). All emails share a consistent branded
// layout defined in `baseLayout`.

const BRAND = {
  name: "SIRz",
  color: "#3752E9",
  colorDark: "#202A88",
  textDark: "#1a1a2e",
  textMuted: "#6b7280",
  bgLight: "#f8f9fc",
  bgCard: "#ffffff",
  border: "#e5e7eb",
  year: new Date().getFullYear(),
};

const LOGO_HTML = `<img src="https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev/assets/sirz-email-icon-transparent.png" alt="SIRz" width="40" height="40" border="0" style="display:block;width:40px;height:40px;" />`;

// ─── Base Layout ─────────────────────────────────────────────────────────────

function baseLayout({ content, previewText }: { content: string; previewText?: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND.name}</title>
  ${previewText ? `<!--[if !mso]><!--><span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${previewText}</span><!--<![endif]-->` : ""}
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bgLight};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.bgLight};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:${BRAND.bgCard};border-radius:16px;border:1px solid ${BRAND.border};overflow:hidden;">
          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding:32px 40px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    ${LOGO_HTML}
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:24px;font-weight:900;color:${BRAND.textDark};letter-spacing:-0.5px;font-family:Arial,sans-serif;">${BRAND.name}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          ${content}

          <!-- Footer -->
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid ${BRAND.border};"></div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 40px 28px;">
              <p style="margin:0;font-size:12px;color:${BRAND.textMuted};line-height:18px;">
                Create. Launch. Grow.
              </p>
              <p style="margin:6px 0 0;font-size:11px;color:${BRAND.textMuted};line-height:16px;">
                &copy; ${BRAND.year} ${BRAND.name}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Reusable Components ─────────────────────────────────────────────────────

function heading(text: string): string {
  return `<tr>
    <td align="center" style="padding:0 40px 8px;">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND.textDark};line-height:30px;">${text}</h1>
    </td>
  </tr>`;
}

function paragraph(text: string): string {
  return `<tr>
    <td align="center" style="padding:0 40px 20px;">
      <p style="margin:0;font-size:15px;color:${BRAND.textMuted};line-height:24px;">${text}</p>
    </td>
  </tr>`;
}

function codeBlock(code: string): string {
  return `<tr>
    <td align="center" style="padding:0 40px 24px;">
      <div style="background:${BRAND.bgLight};border:2px dashed ${BRAND.border};border-radius:12px;padding:20px 24px;">
        <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:${BRAND.textDark};font-family:'Courier New',monospace;">${code}</span>
      </div>
    </td>
  </tr>`;
}

function button(text: string, url: string): string {
  return `<tr>
    <td align="center" style="padding:0 40px 24px;">
      <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;background-color:${BRAND.color};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
        ${text}
      </a>
    </td>
  </tr>`;
}

function note(text: string): string {
  return `<tr>
    <td align="center" style="padding:0 40px 24px;">
      <p style="margin:0;font-size:13px;color:${BRAND.textMuted};line-height:20px;">${text}</p>
    </td>
  </tr>`;
}

// ─── Email Templates ─────────────────────────────────────────────────────────

export function verificationEmail({ code, email }: { code: string; email: string }): { subject: string; html: string; text: string } {
  const content = [
    heading("Verify your email"),
    paragraph(`Enter this code to verify <strong style="color:${BRAND.textDark};">${email}</strong> and get started with ${BRAND.name}.`),
    codeBlock(code),
    note("This code expires in 24 hours. If you didn't create an account, you can safely ignore this email."),
  ].join("");

  return {
    subject: `${code} is your ${BRAND.name} verification code`,
    html: baseLayout({ content, previewText: `Your verification code is ${code}` }),
    text: `Your ${BRAND.name} verification code is: ${code}\n\nEnter this code to verify ${email}.\n\nThis code expires in 24 hours.\nIf you didn't request this, ignore this email.`,
  };
}

export function passwordResetEmail({ code, email }: { code: string; email: string }): { subject: string; html: string; text: string } {
  const content = [
    heading("Reset your password"),
    paragraph(`We received a request to reset the password for <strong style="color:${BRAND.textDark};">${email}</strong>. Use the code below to proceed.`),
    codeBlock(code),
    note("This code expires in 1 hour. If you didn't request a password reset, you can safely ignore this email."),
  ].join("");

  return {
    subject: `${BRAND.name} password reset code`,
    html: baseLayout({ content, previewText: `Your password reset code is ${code}` }),
    text: `Your ${BRAND.name} password reset code is: ${code}\n\nEnter this code to reset your password for ${email}.\n\nThis code expires in 1 hour.\nIf you didn't request this, ignore this email.`,
  };
}

export function campaignPublishedEmail({ campaignName, platformName, postCount }: { campaignName: string; platformName: string; postCount: number }): { subject: string; html: string; text: string } {
  const content = [
    heading("Campaign is live! &#127881;"),
    paragraph(`Your campaign <strong style="color:${BRAND.textDark};">${campaignName}</strong> has been published to ${platformName} with ${postCount} post${postCount !== 1 ? "s" : ""}.`),
    note("Log in to your dashboard to monitor performance and engagement."),
  ].join("");

  return {
    subject: `${campaignName} is now live on ${platformName}`,
    html: baseLayout({ content, previewText: `${campaignName} published to ${platformName}` }),
    text: `Your campaign "${campaignName}" is now live on ${platformName} with ${postCount} post(s).\n\nLog in to your dashboard to monitor performance.`,
  };
}

export function welcomeEmail({ brandName }: { brandName: string }): { subject: string; html: string; text: string } {
  const content = [
    heading(`Welcome to ${BRAND.name}!`),
    paragraph(`<strong style="color:${BRAND.textDark};">${brandName}</strong> is all set up. You're ready to create AI-powered marketing campaigns that drive results.`),
    paragraph("Here's what you can do next:"),
    `<tr>
      <td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:8px 0;font-size:14px;color:${BRAND.textDark};"><strong>1.</strong> Create your first campaign</td></tr>
          <tr><td style="padding:8px 0;font-size:14px;color:${BRAND.textDark};"><strong>2.</strong> Connect TikTok to publish directly</td></tr>
          <tr><td style="padding:8px 0;font-size:14px;color:${BRAND.textDark};"><strong>3.</strong> Try Brandcom for campaign ideas</td></tr>
        </table>
      </td>
    </tr>`,
    note("Need help? Reply to this email or chat with Brandcom in your dashboard."),
  ].join("");

  return {
    subject: `Welcome to ${BRAND.name}, ${brandName}!`,
    html: baseLayout({ content, previewText: `${brandName} is ready to launch campaigns` }),
    text: `Welcome to ${BRAND.name}!\n\n${brandName} is all set up. Create your first campaign, connect TikTok, and chat with Brandcom for ideas.\n\nNeed help? Reply to this email.`,
  };
}

export function trialActivatedEmail({
  customerName,
  planName,
  credits,
  trialEndsAt,
  priceMonthlyCents,
  currency,
  dashboardUrl,
}: {
  customerName?: string;
  planName: string;
  credits: number;
  trialEndsAt: number;
  priceMonthlyCents: number;
  currency: string;
  dashboardUrl: string;
}): { subject: string; html: string; text: string } {
  const name = customerName?.trim() ? ` ${escapeHtml(customerName.trim().split(/\s+/)[0])}` : "";
  const endDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(trialEndsAt);
  const monthlyPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(priceMonthlyCents / 100);
  const safePlan = escapeHtml(planName);

  const content = [
    heading(`Your trial is ready${name}!`),
    paragraph(`You now have <strong style="color:${BRAND.textDark};">${credits.toLocaleString("en-US")} credits</strong> to explore ${BRAND.name} on the ${safePlan} plan.`),
    `<tr>
      <td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;">
          <tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Trial ends</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${endDate}</td></tr>
          <tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">After your trial</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${monthlyPrice}/month</td></tr>
        </table>
      </td>
    </tr>`,
    button("Open your dashboard", dashboardUrl),
    note("You were not charged today. Your selected plan begins after the trial unless you cancel before it ends."),
  ].join("");

  return {
    subject: `Your ${BRAND.name} trial is ready`,
    html: baseLayout({ content, previewText: `${credits} credits are ready to use until ${endDate}` }),
    text: `Your ${BRAND.name} trial is ready${customerName ? `, ${customerName}` : ""}.\n\nYou have ${credits} credits on the ${planName} plan until ${endDate}. After your trial, the plan continues at ${monthlyPrice}/month unless you cancel.\n\nYou were not charged today.\n\nOpen your dashboard: ${dashboardUrl}`,
  };
}

export function planActivatedEmail({
  customerName,
  planName,
  credits,
  amountPaidCents,
  currency,
  nextRenewalAt,
  dashboardUrl,
  invoiceUrl,
}: {
  customerName?: string;
  planName: string;
  credits: number;
  amountPaidCents: number;
  currency: string;
  nextRenewalAt?: number;
  dashboardUrl: string;
  invoiceUrl?: string;
}): { subject: string; html: string; text: string } {
  const name = customerName?.trim() ? ` ${escapeHtml(customerName.trim().split(/\s+/)[0])}` : "";
  const safePlan = escapeHtml(planName);
  const amountPaid = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountPaidCents / 100);
  const nextRenewal = nextRenewalAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(nextRenewalAt)
    : null;
  const safeInvoiceUrl = invoiceUrl ? escapeHtml(invoiceUrl) : null;

  const content = [
    heading(`Your plan is active${name}!`),
    paragraph(`Your <strong style="color:${BRAND.textDark};">${safePlan}</strong> plan is now active, and <strong style="color:${BRAND.textDark};">${credits.toLocaleString("en-US")} monthly credits</strong> are ready to use.`),
    `<tr>
      <td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;">
          <tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Plan</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${safePlan}</td></tr>
          <tr><td style="padding:8px 20px;font-size:13px;color:${BRAND.textMuted};">Payment</td><td align="right" style="padding:8px 20px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${amountPaid}</td></tr>
          <tr><td style="padding:8px 20px ${nextRenewal ? "8px" : "18px"};font-size:13px;color:${BRAND.textMuted};">Credits added</td><td align="right" style="padding:8px 20px ${nextRenewal ? "8px" : "18px"};font-size:14px;font-weight:700;color:${BRAND.textDark};">${credits.toLocaleString("en-US")}</td></tr>
          ${nextRenewal ? `<tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">Next renewal</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${nextRenewal}</td></tr>` : ""}
        </table>
      </td>
    </tr>`,
    button("Open your dashboard", dashboardUrl),
    safeInvoiceUrl
      ? note(`Stripe handles your payment receipt and invoice. <a href="${safeInvoiceUrl}" target="_blank" style="color:${BRAND.color};font-weight:700;">View invoice</a>`)
      : note("Stripe handles your payment receipt and invoice separately."),
  ].join("");

  const invoiceText = invoiceUrl ? `\nView your Stripe invoice: ${invoiceUrl}` : "";
  return {
    subject: `Your ${BRAND.name} ${planName} plan is active`,
    html: baseLayout({ content, previewText: `${credits} monthly credits are ready to use` }),
    text: `Your ${BRAND.name} plan is active${customerName ? `, ${customerName}` : ""}.\n\nPlan: ${planName}\nPayment: ${amountPaid}\nCredits added: ${credits.toLocaleString("en-US")}${nextRenewal ? `\nNext renewal: ${nextRenewal}` : ""}\n\nOpen your dashboard: ${dashboardUrl}${invoiceText}`,
  };
}

export function trialEndingEmail({ planName, trialEndsAt, credits, billingUrl, priceMonthlyCents, currency }: {
  planName: string;
  trialEndsAt: number;
  credits: number;
  billingUrl: string;
  priceMonthlyCents?: number;
  currency?: string;
}): { subject: string; html: string; text: string } {
  const endDate = formatDate(trialEndsAt);
  const monthlyPrice = typeof priceMonthlyCents === "number" && priceMonthlyCents > 0
    ? new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(priceMonthlyCents / 100)
    : null;
  const content = [
    heading("Your trial is ending soon"),
    paragraph(`Your ${escapeHtml(planName)} trial ends on <strong style="color:${BRAND.textDark};">${endDate}</strong>. You currently have <strong style="color:${BRAND.textDark};">${credits.toLocaleString("en-US")} credits</strong> remaining.`),
    monthlyPrice
      ? paragraph(`After the trial, your selected plan continues at <strong style="color:${BRAND.textDark};">${monthlyPrice}/month</strong> unless you cancel before then.`)
      : "",
    button("Review billing", billingUrl),
    note("You can review or cancel from Billing before the trial ends."),
  ].join("");
  return {
    subject: `Your ${BRAND.name} trial ends soon`,
    html: baseLayout({ content, previewText: `Your trial ends on ${endDate}` }),
    text: `Your ${BRAND.name} trial ends on ${endDate}. You have ${credits.toLocaleString("en-US")} credits remaining.${monthlyPrice ? ` After the trial, your selected plan continues at ${monthlyPrice}/month unless you cancel before then.` : ""}\n\nReview billing: ${billingUrl}`,
  };
}

export function subscriptionCancelledEmail({ planName, accessEndsAt, billingUrl, ended }: {
  planName: string;
  accessEndsAt?: number;
  billingUrl: string;
  ended: boolean;
}): { subject: string; html: string; text: string } {
  const endDate = accessEndsAt ? formatDate(accessEndsAt) : null;
  const headingText = ended ? "Your subscription has ended" : "Your cancellation is confirmed";
  const detail = ended
    ? `Your ${escapeHtml(planName)} subscription has ended. Your account and existing work remain available, but paid AI access is no longer active.`
    : `Your ${escapeHtml(planName)} subscription will not renew${endDate ? ` after <strong style="color:${BRAND.textDark};">${endDate}</strong>` : ""}. You can continue using paid access until then.`;
  const content = [
    heading(headingText),
    paragraph(detail),
    button(ended ? "Choose a plan" : "Review billing", billingUrl),
    note(ended ? "You can restart a subscription whenever you are ready." : "Changed your mind? You can manage the subscription before access ends."),
  ].join("");
  return {
    subject: ended ? `Your ${BRAND.name} subscription has ended` : `Your ${BRAND.name} cancellation is confirmed`,
    html: baseLayout({ content, previewText: ended ? "Your paid access has ended" : "Your subscription will not renew" }),
    text: ended
      ? `Your ${BRAND.name} ${planName} subscription has ended.\n\nChoose a plan: ${billingUrl}`
      : `Your ${BRAND.name} ${planName} subscription will not renew${endDate ? ` after ${endDate}` : ""}.\n\nReview billing: ${billingUrl}`,
  };
}

export function subscriptionResumedEmail({ planName, nextRenewalAt, billingUrl }: {
  planName: string;
  nextRenewalAt?: number;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const renewalDate = nextRenewalAt ? formatDate(nextRenewalAt) : null;
  const content = [
    heading("Your subscription will continue"),
    paragraph(`Your cancellation was reversed and your ${escapeHtml(planName)} subscription remains active${renewalDate ? ` with its next renewal on <strong style="color:${BRAND.textDark};">${renewalDate}</strong>` : ""}.`),
    button("Review billing", billingUrl),
    note("No interruption was made to your plan or available credits."),
  ].join("");
  return {
    subject: `Your ${BRAND.name} subscription will continue`,
    html: baseLayout({ content, previewText: "Your cancellation was reversed" }),
    text: `Your ${BRAND.name} ${planName} subscription will continue${renewalDate ? ` and renew on ${renewalDate}` : ""}. No interruption was made to your plan or credits.\n\nReview billing: ${billingUrl}`,
  };
}

export function planUpgradedEmail({ planName, credits, amountPaidCents, currency, nextRenewalAt, billingUrl, invoiceUrl }: {
  planName: string;
  credits: number;
  amountPaidCents: number;
  currency: string;
  nextRenewalAt?: number;
  billingUrl: string;
  invoiceUrl?: string;
}): { subject: string; html: string; text: string } {
  const amount = formatMoney(amountPaidCents, currency);
  const renewalDate = nextRenewalAt ? formatDate(nextRenewalAt) : null;
  const content = [
    heading(`You are now on ${escapeHtml(planName)}`),
    paragraph(`Your upgrade is complete and <strong style="color:${BRAND.textDark};">${credits.toLocaleString("en-US")} prorated credits</strong> were added without changing your existing balance.`),
    `<tr><td style="padding:0 40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;"><tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Upgrade payment</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${amount}</td></tr><tr><td style="padding:8px 20px ${renewalDate ? "8px" : "18px"};font-size:13px;color:${BRAND.textMuted};">Credits added</td><td align="right" style="padding:8px 20px ${renewalDate ? "8px" : "18px"};font-size:14px;font-weight:700;color:${BRAND.textDark};">${credits.toLocaleString("en-US")}</td></tr>${renewalDate ? `<tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">Next renewal</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${renewalDate}</td></tr>` : ""}</table></td></tr>`,
    button("Review billing", billingUrl),
    invoiceUrl ? note(`<a href="${escapeHtml(invoiceUrl)}" target="_blank" style="color:${BRAND.color};font-weight:700;">View your Stripe invoice</a>`) : "",
  ].join("");
  return {
    subject: `Your ${BRAND.name} upgrade to ${planName} is complete`,
    html: baseLayout({ content, previewText: `${credits.toLocaleString("en-US")} prorated credits were added` }),
    text: `Your ${BRAND.name} upgrade to ${planName} is complete.\n\nUpgrade payment: ${amount}\nCredits added: ${credits.toLocaleString("en-US")}${renewalDate ? `\nNext renewal: ${renewalDate}` : ""}\n\nReview billing: ${billingUrl}${invoiceUrl ? `\nInvoice: ${invoiceUrl}` : ""}`,
  };
}

export function planDowngradeScheduledEmail({ currentPlanName, nextPlanName, effectiveAt, billingUrl }: {
  currentPlanName: string;
  nextPlanName: string;
  effectiveAt?: number;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const currentPlan = escapeHtml(currentPlanName);
  const nextPlan = escapeHtml(nextPlanName);
  const effectiveDate = effectiveAt ? formatDate(effectiveAt) : "your next renewal";
  const content = [
    heading(`Your move to ${nextPlan} is set`),
    paragraph(`Your <strong style="color:${BRAND.textDark};">${currentPlan}</strong> plan stays active until <strong style="color:${BRAND.textDark};">${effectiveDate}</strong>. After that, your account will move to <strong style="color:${BRAND.textDark};">${nextPlan}</strong>.`),
    `<tr><td style="padding:0 40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;"><tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Current plan</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${currentPlan}</td></tr><tr><td style="padding:8px 20px;font-size:13px;color:${BRAND.textMuted};">Next plan</td><td align="right" style="padding:8px 20px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${nextPlan}</td></tr><tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">Changes on</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${effectiveDate}</td></tr></table></td></tr>`,
    button("Review billing", billingUrl),
    note("Your existing work and current plan access continue until the change takes effect."),
  ].join("");
  return {
    subject: `Your ${BRAND.name} plan will move to ${nextPlanName}`,
    html: baseLayout({ content, previewText: `Your ${currentPlanName} plan stays active until ${effectiveDate}` }),
    text: `Your ${BRAND.name} plan change is set.\n\nCurrent plan: ${currentPlanName}\nNext plan: ${nextPlanName}\nChanges on: ${effectiveDate}\n\nYour current plan access continues until the change takes effect.\n\nReview billing: ${billingUrl}`,
  };
}

export function paymentFailedEmail({ planName, billingUrl }: {
  planName: string;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const content = [
    heading("We could not process your payment"),
    paragraph(`The latest payment for your ${escapeHtml(planName)} plan was unsuccessful. Update your payment method to avoid interruption.`),
    button("Update payment method", billingUrl),
    note("If you have already updated your payment details, no further action is needed."),
  ].join("");
  return {
    subject: `Action needed: ${BRAND.name} payment failed`,
    html: baseLayout({ content, previewText: "Please update your payment method" }),
    text: `We could not process your ${BRAND.name} ${planName} payment. Update your payment method: ${billingUrl}`,
  };
}

export function renewalUpcomingEmail({ planName, renewalAt, amountDueCents, currency, billingUrl }: {
  planName: string;
  renewalAt?: number;
  amountDueCents: number;
  currency: string;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const renewalDate = renewalAt ? formatDate(renewalAt) : "your next renewal";
  const amount = amountDueCents > 0 ? formatMoney(amountDueCents, currency) : null;
  const safePlan = escapeHtml(planName);
  const content = [
    heading("Your plan renews soon"),
    paragraph(`Your <strong style="color:${BRAND.textDark};">${safePlan}</strong> plan is set to renew on <strong style="color:${BRAND.textDark};">${renewalDate}</strong>.`),
    `<tr><td style="padding:0 40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;"><tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Plan</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${safePlan}</td></tr><tr><td style="padding:8px 20px ${amount ? "8px" : "18px"};font-size:13px;color:${BRAND.textMuted};">Renewal date</td><td align="right" style="padding:8px 20px ${amount ? "8px" : "18px"};font-size:14px;font-weight:700;color:${BRAND.textDark};">${renewalDate}</td></tr>${amount ? `<tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">Expected payment</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${amount}</td></tr>` : ""}</table></td></tr>`,
    button("Review billing", billingUrl),
    note("No action is needed if your payment method is up to date."),
  ].join("");
  return {
    subject: `Your ${BRAND.name} plan renews soon`,
    html: baseLayout({ content, previewText: `Your ${planName} plan renews on ${renewalDate}` }),
    text: `Your ${BRAND.name} ${planName} plan renews on ${renewalDate}${amount ? ` for ${amount}` : ""}.\n\nNo action is needed if your payment method is up to date.\n\nReview billing: ${billingUrl}`,
  };
}

export function lowCreditsEmail({ credits, threshold, trialing, billingUrl }: {
  credits: number;
  threshold: number;
  trialing: boolean;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const action = trialing ? "Activate your plan" : "Get more credits";
  const content = [
    heading("Your credits are running low"),
    paragraph(`You have <strong style="color:${BRAND.textDark};">${credits.toLocaleString("en-US")} credits</strong> remaining. Add more before your next generation to keep your work moving.`),
    button(action, billingUrl),
    note(`This reminder is sent when your balance reaches ${threshold.toLocaleString("en-US")} credits or fewer.`),
  ].join("");
  return {
    subject: `Your ${BRAND.name} credits are running low`,
    html: baseLayout({ content, previewText: `${credits.toLocaleString("en-US")} credits remaining` }),
    text: `You have ${credits.toLocaleString("en-US")} ${BRAND.name} credits remaining.\n\n${action}: ${billingUrl}`,
  };
}

export function topUpCompletedEmail({ creditsAdded, balance, amountPaidCents, currency, billingUrl }: {
  creditsAdded: number;
  balance: number;
  amountPaidCents: number;
  currency: string;
  billingUrl: string;
}): { subject: string; html: string; text: string } {
  const amount = formatMoney(amountPaidCents, currency);
  const content = [
    heading("Your credits have been added"),
    paragraph(`<strong style="color:${BRAND.textDark};">${creditsAdded.toLocaleString("en-US")} credits</strong> were added successfully.`),
    `<tr><td style="padding:0 40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgLight};border:1px solid ${BRAND.border};border-radius:12px;"><tr><td style="padding:18px 20px 8px;font-size:13px;color:${BRAND.textMuted};">Payment</td><td align="right" style="padding:18px 20px 8px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${amount}</td></tr><tr><td style="padding:8px 20px 18px;font-size:13px;color:${BRAND.textMuted};">Available balance</td><td align="right" style="padding:8px 20px 18px;font-size:14px;font-weight:700;color:${BRAND.textDark};">${balance.toLocaleString("en-US")} credits</td></tr></table></td></tr>`,
    button("View billing", billingUrl),
    note("Stripe sends the official payment receipt separately."),
  ].join("");
  return {
    subject: `${creditsAdded.toLocaleString("en-US")} credits added to ${BRAND.name}`,
    html: baseLayout({ content, previewText: `Your new balance is ${balance.toLocaleString("en-US")} credits` }),
    text: `${creditsAdded.toLocaleString("en-US")} credits were added to your ${BRAND.name} account.\nPayment: ${amount}\nAvailable balance: ${balance.toLocaleString("en-US")} credits\n\nView billing: ${billingUrl}`,
  };
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(timestamp);
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
