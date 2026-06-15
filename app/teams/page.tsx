'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
// import emailjs from '@emailjs/browser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { UserPlus, Mail, Trash2, Loader2, Copy, Check, RefreshCw, Edit2, Save, X } from 'lucide-react';
import { toast } from 'sonner';

interface TeamMember {
  _id: Id<'users'>;
  name?: string;
  email?: string;
  image?: string;
  roleName?: string;
  status: 'active' | 'inactive';
  lastActive: string;
  dateJoined: string;
  isActive?: boolean;
  _creationTime: number;
}

interface Invite {
  _id: Id<'invites'>;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  invitedBy: Id<'users'>;
  expiresAt: number;
  _creationTime: number;
}

export default function TeamPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('admin');
  const [inviteError, setInviteError] = useState('');
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [recreatingInviteId, setRecreatingInviteId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<Id<'teams'> | null>(null);
  const [tempRole, setTempRole] = useState<string>('');
  const [savingMemberId, setSavingMemberId] = useState<Id<'teams'> | null>(null);

  // Fetch team members
  const teamData = useQuery(api.teams.list, {
    paginationOpts: { numItems: 100, cursor: null }
  });
  const teamLoading = teamData === undefined;

  // Fetch invites
  const invitesData = useQuery(api.invites.list, {
    paginationOpts: { numItems: 100, cursor: null }
  });
  const invitesLoading = invitesData === undefined;

  // Fetch all roles
  const rolesData = useQuery(api.roles.listAll, {});
  const rolesLoading = rolesData === undefined;

  // Create invite mutation
  const createInvite = useMutation(api.invites.create);
  const deactivateMember = useMutation(api.teams.deactivate);
  const updateUserRole = useMutation(api.teams.updateRole);

  const team = teamData?.page || [];
  const invites = invitesData?.page || [];

  const handleInvite = async () => {
    setInviteError('');

    // Basic email validation
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteError('Please enter a valid email address');
      return;
    }

    // Check if email already exists in team
    if (team.some((member) => member.email === inviteEmail)) {
      setInviteError('This email is already a team member');
      return;
    }

    // Check if email already has a pending invite
    if (invites.some((invite) => invite.email === inviteEmail && invite.status === 'pending')) {
      setInviteError('This email already has a pending invitation');
      return;
    }

    try {
      const result = await createInvite({ email: inviteEmail, role: inviteRole });
      console.log('Invite created:', result);

      toast.success('Invitation sent successfully!');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('admin');
    } catch (error) {
      console.error('Failed to create invite:', error);
      setInviteError('Failed to send invitation. Please try again.');
    }
  };

  const handleCopyInviteLink = async (invite: any) => {
    const inviteLink = `${window.location.origin}?token=${invite.token}`;
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedInviteId(invite._id);
      toast.success('Invite link copied to clipboard!');
      
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedInviteId(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast.error('Failed to copy invite link');
    }
  };

  const handleRecreateInvite = async (invite: any) => {
    setRecreatingInviteId(invite._id);
    
    try {
      const result = await createInvite({ email: invite.email, role: invite.role });

      toast.success('New invitation created successfully!');
    } catch (error) {
      console.error('Failed to recreate invite:', error);
      toast.error('Failed to recreate invitation. Please try again.');
    } finally {
      setRecreatingInviteId(null);
    }
  };

  const handleEditRole = (memberId: Id<'teams'>, currentRole: string) => {
    setEditingMemberId(memberId);
    setTempRole(currentRole);
  };

  const handleSaveRole = async (memberId: Id<'teams'>) => {
    setSavingMemberId(memberId);
    try {
      await updateUserRole({ id: memberId, roleName: tempRole });
      toast.success('User role updated successfully!');
      setEditingMemberId(null);
      setTempRole('');
    } catch (error) {
      console.error('Failed to update role:', error);
      toast.error('Failed to update user role. Please try again.');
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingMemberId(null);
    setTempRole('');
  };

  const handleRemoveMember = async (memberId: Id<'teams'>) => {
    try {
      await deactivateMember({ id: memberId });
      toast.success('Team member deactivated successfully');
    } catch (error) {
      console.error('Failed to deactivate member:', error);
      toast.error('Failed to deactivate team member');
    }
  };

  const getRoleColor = (role: string) => {
    const roleColors: Record<string, string> = {
      admin: 'bg-red-500/20 text-red-300',
      manager: 'bg-blue-500/20 text-blue-300',
    };
    return roleColors[role] || 'bg-gray-500/20 text-gray-300';
  };

  const getAvailableRoles = () => {
    if (!rolesData || rolesLoading) return [];
    return rolesData.map(role => role.name);
  };

  return (
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Team Members</h1>
          <p className="text-muted-foreground mt-1">
            Manage your team members and their roles
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="w-4 h-4" />
              Invite Team Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Send an invitation email to add a new team member to your workspace
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="example@domain.com"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setInviteError('');
                  }}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {inviteError && (
                  <p className="text-destructive text-sm mt-2">{inviteError}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {getAvailableRoles().map((role) => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-secondary p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">
                  An invitation email will be sent to {inviteEmail || 'the email address'} with instructions to join the workspace.
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setInviteOpen(false);
                    setInviteEmail('');
                    setInviteRole('admin');
                    setInviteError('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleInvite}>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Invitation
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Total Members</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {teamLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : team.length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Active</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {teamLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : team.filter((m) => m.status === 'active').length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Pending Invites</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {invitesLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : invites.filter((i) => i.status === 'pending' && i.expiresAt >= Date.now()).length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Admins</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {teamLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : team.filter((m) => m.roleName === 'admin').length}
          </p>
        </div>
      </div>

      {/* Team Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border bg-secondary/50">
              <TableHead className="text-foreground font-semibold">Name</TableHead>
              <TableHead className="text-foreground font-semibold">Email</TableHead>
              <TableHead className="text-foreground font-semibold">Role</TableHead>
              <TableHead className="text-foreground font-semibold">Created</TableHead>
              <TableHead className="text-foreground font-semibold">Last Active</TableHead>
              <TableHead className="text-foreground font-semibold">Status</TableHead>
              <TableHead className="text-foreground font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  <p className="text-muted-foreground mt-2">Loading team members...</p>
                </TableCell>
              </TableRow>
            ) : team.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <p className="text-muted-foreground">No team members found</p>
                </TableCell>
              </TableRow>
            ) : (
              team.map((member) => (
                <TableRow
                  key={member._id}
                  className="border-b border-border hover:bg-secondary/50 transition-colors"
                >
                  <TableCell className="text-foreground font-medium">
                    <div className="flex items-center gap-2">
                      {member.image && (
                        <img
                          src={member.image}
                          alt={member.name || 'User'}
                          className="w-8 h-8 rounded-full"
                        />
                      )}
                      {member.name || member.email || 'Unknown'}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{member.email}</TableCell>
                  <TableCell>
                    {editingMemberId === member._id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={tempRole}
                          onChange={(e) => setTempRole(e.target.value)}
                          className="px-2 py-1 bg-input text-foreground rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        >
                          {getAvailableRoles().map((role) => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSaveRole(member._id)}
                          disabled={savingMemberId === member._id}
                          className="p-1 text-green-500 hover:text-green-400 transition-colors disabled:opacity-50"
                          title="Save role"
                        >
                          {savingMemberId === member._id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 text-red-500 hover:text-red-400 transition-colors"
                          title="Cancel edit"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getRoleColor(
                            member.roleName || 'admin'
                          )}`}
                        >
                          {(member.roleName || 'admin').charAt(0).toUpperCase() + (member.roleName || 'admin').slice(1)}
                        </span>
                        {member.roleName !== 'admin' && (
                          <button
                            onClick={() => handleEditRole(member._id, member.roleName || 'admin')}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit role"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {member.dateJoined}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {member.lastActive}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={member.status === 'active' ? 'active' : 'inactive'}
                    />
                  </TableCell>
                  <TableCell>
                    {member.roleName !== 'admin' && (
                      <button
                        onClick={() => handleRemoveMember(member._id)}
                        className="text-destructive hover:text-red-400 p-2 hover:bg-destructive/10 rounded transition-colors"
                        title="Deactivate member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pending Invites Section */}
      {invites.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/50">
            <h2 className="text-lg font-semibold text-foreground">Invitations</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage team invitations
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-foreground font-semibold">Email</TableHead>
                <TableHead className="text-foreground font-semibold">Role</TableHead>
                <TableHead className="text-foreground font-semibold">Invited</TableHead>
                <TableHead className="text-foreground font-semibold">Expires</TableHead>
                <TableHead className="text-foreground font-semibold">Status</TableHead>
                <TableHead className="text-foreground font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitesLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    <p className="text-muted-foreground mt-2">Loading invites...</p>
                  </TableCell>
                </TableRow>
              ) : (
                invites.map((invite) => {
                  const isExpired = invite.expiresAt < Date.now();
                  const isPending = invite.status === 'pending' && !isExpired;
                  
                  return (
                    <TableRow
                      key={invite._id}
                      className="border-b border-border hover:bg-secondary/50 transition-colors"
                    >
                      <TableCell className="text-foreground font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getRoleColor(
                            invite.role
                          )}`}
                        >
                          {invite.role.charAt(0).toUpperCase() + invite.role.slice(1)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(invite._creationTime).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(invite.expiresAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={isExpired ? 'expired' : invite.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <>
                              <span className="text-xs text-muted-foreground font-mono">
                                .../{invite.token.slice(-8)}
                              </span>
                              <button
                                onClick={() => handleCopyInviteLink(invite)}
                                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                                title="Copy invite link"
                              >
                                {copiedInviteId === invite._id ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </>
                          )}
                          {isExpired && (
                            <button
                              onClick={() => handleRecreateInvite(invite)}
                              disabled={recreatingInviteId === invite._id}
                              className="flex items-center gap-2 px-3 py-1 text-sm bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded-md transition-colors disabled:opacity-50"
                              title="Recreate invite"
                            >
                              {recreatingInviteId === invite._id ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-4 h-4" />
                                  Recreate
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
      </div>
  );
}
