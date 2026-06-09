const brandName = process.env.APP_NAME ?? "Sirz";
const fromEmail = "Sirz <no-reply@rekobo.store>";
const appBaseUrl = process.env.SITE_URL

export function generateEmail({
  type,
  email,
  subject,
  token,
  expires,
  message = "Click the button below to verify your email address and continue.",
  cta = "Verify Email",
  disclaimer = "If you did not request this verification, please ignore this message — no further action is required.",
  businessName,
}: {
  type?: string;
  email: string;
  subject: string;
  token: string;
  expires: number;
  message?: string;
  cta?: string;
  disclaimer?: string;
  businessName?: string;
}) {
  const minutesValid = Math.floor((+expires - Date.now()) / (60 * 1000));

  // Construct verification link
  // const verifyUrl = `${appBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const verifyUrl = `https://admin-ancl.vercel.app?token=${encodeURIComponent(token)}`;

  // Construct invite accept link
  // const inviteUrl = `${appBaseUrl}?token=${encodeURIComponent(token)}`;
  const inviteUrl = `https://admin-ancl.vercel.app?token=${encodeURIComponent(token)}`;

  return {
    from: fromEmail,
    to: [email],
    subject,
    html: `
      <div style="background:#f4f7f5;padding:40px 20px;">
        <div style="
          max-width:600px;
          margin:auto;
          background:#ffffff;
          border-radius:24px;
          overflow:hidden;
          box-shadow:0 10px 40px rgba(0,0,0,0.08);
          font-family:Inter,Arial,sans-serif;
        ">

          <!-- Hero -->
          <div style="
            background: linear-gradient(
              135deg,
              #012b73 0%,
              #0159e6 55%,
              #60a5fa 100%
            );
            padding:40px 30px;
            text-align:center;
          ">
            <img
              src="https://admin-ancl.vercel.app/logo.png"
              alt="Sirz"
              width="180"
              style="margin-bottom:20px;"
            />

            <h1 style="
              margin:0;
              color:#fff;
              font-size:28px;
              line-height:1.3;
              font-weight:700;
            ">
              ${subject}
            </h1>

            <p style="
              margin-top:12px;
              color:rgba(255,255,255,.85);
              font-size:15px;
            ">
              Trusted Marketplace for Smart Buying & Selling
            </p>
          </div>

          <!-- Body -->
          <div style="padding:40px 32px;">

            <p style="
              margin:0 0 20px;
              color:#2d3748;
              font-size:16px;
              line-height:1.7;
            ">
              ${message}
            </p>

            ${
              type === "passwordReset"
                ? `
                  <div style="
                    margin:32px 0;
                    background:#f8faf9;
                    border:2px dashed #088b56;
                    border-radius:18px;
                    text-align:center;
                    padding:28px;
                  ">
                    <p style="
                      margin:0 0 10px;
                      color:#666;
                      font-size:13px;
                      text-transform:uppercase;
                      letter-spacing:2px;
                    ">
                      Verification Code
                    </p>

                    <div style="
                      font-size:42px;
                      font-weight:800;
                      color:#088b56;
                      letter-spacing:10px;
                    ">
                      ${token}
                    </div>

                    <p style="
                      margin-top:16px;
                      color:#666;
                      font-size:13px;
                    ">
                      Expires in ${minutesValid} minutes
                    </p>
                  </div>
                `
                : type === "invite"
                ? `
                  <div style="
                    text-align:center;
                    margin:36px 0;
                  ">
                    <div style="
                      background:#f8faf9;
                      border-radius:18px;
                      padding:24px;
                      margin-bottom:24px;
                    ">
                      <h3 style="
                        margin:0 0 10px;
                        color:#111;
                      ">
                        🎉 You're Invited
                      </h3>

                      <p style="
                        margin:0;
                        color:#555;
                        font-size:15px;
                      ">
                        Join <strong>${businessName}</strong> and start managing operations through Sirz.
                      </p>
                    </div>

                    <a
                      href="${inviteUrl}"
                      style="
                        display:inline-block;
                        background:linear-gradient(135deg,#0159e6,#0159e6);
                        color:#fff;
                        text-decoration:none;
                        padding:16px 32px;
                        border-radius:14px;
                        font-weight:700;
                        font-size:15px;
                        box-shadow:0 8px 20px rgba(8,139,86,.25);
                      "
                    >
                      Accept Invitation →
                    </a>

                    <p style="
                      margin-top:18px;
                      color:#777;
                      font-size:13px;
                    ">
                      Invitation expires in ${minutesValid} minutes
                    </p>
                  </div>
                `
                : `
                  <div style="
                    text-align:center;
                    margin:36px 0;
                  ">
                    <a
                      href="${verifyUrl}"
                      style="
                        display:inline-block;
                        background:linear-gradient(135deg,#088b56,#0aa96a);
                        color:#fff;
                        text-decoration:none;
                        padding:16px 32px;
                        border-radius:14px;
                        font-weight:700;
                        font-size:15px;
                        box-shadow:0 8px 20px rgba(8,139,86,.25);
                      "
                    >
                      ${cta}
                    </a>

                    <p style="
                      margin-top:18px;
                      color:#777;
                      font-size:13px;
                    ">
                      This link expires in ${minutesValid} minutes
                    </p>
                  </div>
                `
            }

            <!-- Security Notice -->
            <div style="
              background:#fff9ec;
              border-left:4px solid #c9a227;
              border-radius:12px;
              padding:16px;
              margin-top:20px;
            ">
              <p style="
                margin:0;
                color:#6b7280;
                font-size:13px;
                line-height:1.6;
              ">
                🔒 ${disclaimer}
              </p>
            </div>

          </div>

          <!-- Footer -->
          <div style="
            background:#fafafa;
            border-top:1px solid #ececec;
            padding:24px;
            text-align:center;
          ">
            <p style="
              margin:0;
              color:#888;
              font-size:12px;
            ">
              © ${new Date().getFullYear()} ${brandName}. All rights reserved.
            </p>

            <p style="
              margin-top:8px;
              color:#aaa;
              font-size:11px;
            ">
              Secure • Trusted • Built for Commerce
            </p>
          </div>

        </div>
      </div>
      `

  };
}

