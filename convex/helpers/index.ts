import { ConvexError } from "convex/values";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { filter } from "convex-helpers/server/filter";
import { PaginationOptions } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";


export const getAuthenticatedMember = async (ctx: QueryCtx | MutationCtx) => {
    const memberId = await getAuthUserId(ctx);
    return memberId !== null ? ctx.db.get(memberId) : null;
}

export const getTeamMemberById = async (ctx: QueryCtx, id: Id<'teams'>) => {
    return await ctx.db.get(id);
}


export const getResourceExistsMessage = (resource: string, label: string, labelType: string) => {
    return `${resource} with ${label} ${labelType} already exists`
}

export const getValidationMessage = (parameter: string, invalidState: string = 'empty') => {
    return `${parameter} parameter can not be ${invalidState}`
}

export const getRoleById = async (ctx: QueryCtx, id: Id<'roles'>) => {
    return await ctx.db.get(id);
}

export const queryRolesList = async (ctx: QueryCtx, args: { teamMemberId?: Id<'teams'> | undefined, paginationOpts?: PaginationOptions | undefined, roleName?: string }) => {
    const { teamMemberId, paginationOpts, roleName } = args
    let query = ctx.db.query('roles')

    if (teamMemberId || roleName) {
        let roleId: Id<'roles'> | undefined

        if (teamMemberId) {
            const memberRole = await getRoleUserByTeamMemberId(ctx, teamMemberId);
            roleId = memberRole?.roleId;
        }

        query = filter(
            ctx.db.query('roles'),
            (role) => {
                const teamMemberIdCheck = teamMemberId
                    ? roleId === role._id
                    : true
                const roleNameCheck = roleName
                    ? role.name === roleName
                    : true


                return teamMemberIdCheck && roleNameCheck
            }
        )
    }

    if (paginationOpts) {
        return {
            paginatedResults: await query.order('desc')
                .paginate(paginationOpts)
        }
    }

    return {
        results: await query.order('desc')
            .collect()
    }
}

export const getPermissionsByNames = (ctx: QueryCtx, permissionNames: string[]) => {
    return filter(
        ctx.db.query('permissions'),
        (permission) => permissionNames.includes(permission.name)
    ).collect()
}

export const getMissingPermissionNames = (permissions: Doc<'permissions'>[], permissionNames: string[]) => {
    const existingPermissionNames = permissions.map(item => item.name)
    return permissionNames.filter(item => !existingPermissionNames.includes(item))
}

export const getPermissionsAndMissingPermissionNames = async (ctx: MutationCtx, permissionNames: string[]) => {
    const permissions = await getPermissionsByNames(ctx, permissionNames);
    const missingPermissionNames = getMissingPermissionNames(permissions, permissionNames);

    return { permissions, missingPermissionNames }
}

export const syncPermissionsWithRoleById = async (ctx: MutationCtx, existingPermissions: Doc<'permissions'>[], roleId: Id<'roles'>) => {
    const permissionRoleIds = existingPermissions.map(item => {
        return {
            permissionId: item._id,
            roleId
        }
    })

    const permissionRoles = await filter(
        ctx.db.query('permissionRoles'),
        (permissionRole) => {
            let value = true

            value = value && permissionRoleIds
                .some(item => item.permissionId === permissionRole.permissionId && item.roleId === permissionRole.roleId)

            return value
        }
    ).collect()

    const syncablePermissionRoleIds = permissionRoleIds.filter(item => {
        return !permissionRoles
            .some(permissionRole => permissionRole.permissionId === item.permissionId && permissionRole.roleId == item.roleId)
    })

    const syncPermissionsOperations = syncablePermissionRoleIds
        .map(item => {
            return ctx.db.insert('permissionRoles', {
                roleId: item.roleId,
                permissionId: item.permissionId
            });
        });

    if (syncPermissionsOperations.length > 0) {
        await Promise.all(syncPermissionsOperations);
    }
}

export const updateRolePermissions = async (ctx: MutationCtx, roleId: Id<'roles'>, permissionNames: string[]) => {
    // Make sure all the permission names exist.
    const { permissions, missingPermissionNames } = await getPermissionsAndMissingPermissionNames(ctx, permissionNames)

    if (missingPermissionNames.length !== 0) {
        throw new ConvexError(`Permission names: ${permissionNames.join(', ')} do not exist.`)
    }

    // Sync permission names
    await syncPermissionsWithRoleById(ctx, permissions, roleId)
}

export const getRoleUserByTeamMemberId = async (ctx: QueryCtx, memberId: Id<'teams'>) => {
    return await ctx.db.query('roleTeams')
        .withIndex('by_team', (q) => q.eq('teamId', memberId))
        .unique()
}


export const getRoleByMemberId = async (ctx: QueryCtx, memberId: Id<'teams'>) => {
    const memberRole = await getRoleUserByTeamMemberId(ctx, memberId)

    if (memberRole) {
        return await getRoleById(ctx, memberRole.roleId)
    }

    return null
}

export const getRoleByName = async (ctx: MutationCtx, name: string) => {
    return await ctx.db.query("roles")
        .withIndex("by_name", (q) => q.eq("name", name))
        .first();
}

export const linkTeamRole = async (ctx: MutationCtx, memberId: Id<'teams'>, roleName: string) => {
    // Make sure all the role name exists.
    const existingRole = await getRoleByName(ctx, roleName)

    if (!existingRole) {
        throw new ConvexError(`Role named ${roleName} does not exist.`)
    }

    // Get existing role member for given member id
    const existingMemberRole = await getRoleUserByTeamMemberId(ctx, memberId)

    // If role member record exists and the current role is different
    // from given role
    if (existingMemberRole && existingMemberRole.roleId !== existingRole._id) {
        // update role id of the role member record
        await ctx.db.patch(existingMemberRole._id, {
            roleId: existingRole._id
        })
    }

    // If role member record does not exist
    if (!existingMemberRole) {
        // insert a new role member record
        await ctx.db.insert('roleTeams', {
            roleId: existingRole._id,
            teamId: memberId
        });
    }
}


export async function getCurrentTeamMember(
  ctx: QueryCtx | MutationCtx
) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Not authenticated");
  }

  const teamMember = await ctx.db
    .query("teams")
    .withIndex("by_clerkId", (q) =>
      q.eq("clerkId", identity.subject)
    )
    .unique();

  if (!teamMember) {
    throw new Error("Team member not found");
  }

  return teamMember;
}