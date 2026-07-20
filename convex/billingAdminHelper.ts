import { getCurrentTeamMember } from "./helpers";

async function requireBillingAdmin(ctx: any) {
  const teamMember = await getCurrentTeamMember(ctx);

  if (!teamMember) {
    throw new Error("Unauthenticated");
  }

  return teamMember;
}