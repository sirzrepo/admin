export function extractAuthError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("InvalidAccountId")) return "Account not found.";
  if (msg.includes("InvalidPassword")) return "Incorrect password.";
  if (msg.includes("AccountAlreadyExists")) return "Account already exists.";

  return "Something went wrong. Please try again.";
}