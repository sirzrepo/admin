'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
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
import { UserPlus, Mail, Trash2 } from 'lucide-react';

export default function TeamPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [inviteError, setInviteError] = useState('');

  const currentUser = useQuery(api.users.getMe);
  // const teamMembers = useQuery(api.users.getTeamMembers) || [];
  const teamMembers = currentUser ? [currentUser] : []; // Use only current user for now
  const invites = useQuery(api.invites.getInvites) || [];
  const createInvite = useMutation(api.invites.createInvite);
  // const removeMember = useMutation(api.users.removeTeamMember);

  const handleInvite = async () => {
    setInviteError('');

    // Basic email validation
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteError('Please enter a valid email address');
      return;
    }

    // Check if email already exists in team or invites
    if (teamMembers.some((member: any) => member.email === inviteEmail) || 
        invites.some((invite: any) => invite.email === inviteEmail)) {
      setInviteError('This email is already invited or is a team member');
      return;
    }

    try {
      console.log('Creating invite with:', { email: inviteEmail, role: inviteRole });
      console.log('Current user:', currentUser);
      
      const result = await createInvite({ email: inviteEmail, role: inviteRole });
      console.log('Invite created successfully:', result);
      
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('user');
    } catch (error) {
      console.error('Failed to create invite:', error);
      setInviteError(`Failed to send invitation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    // TODO: Implement remove team member functionality when API is available
    console.log('Remove member:', memberId);
    // try {
    //   await removeMember({ userId: memberId as any });
    // } catch (error) {
    //   console.error('Failed to remove member:', error);
    // }
  };

  const getRoleColor = (role: string) => {
    const roleColors: Record<string, string> = {
      admin: 'bg-red-500/20 text-red-300',
      user: 'bg-green-500/20 text-green-300',
    };
    return roleColors[role] || 'bg-gray-500/20 text-gray-300';
  };

  // Combine team members and pending invites for display
  const allMembers = [
    ...teamMembers.map((member: any) => ({ ...member, status: 'active' })),
    ...invites.map((invite: any) => ({ 
      ...invite, 
      status: 'pending',
      name: invite.email.split('@')[0],
      lastActive: 'Never'
    }))
  ];

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
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
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
                    setInviteRole('user');
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
          <p className="text-2xl font-bold text-foreground mt-2">{allMembers.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Active</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {teamMembers.length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Pending Invites</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {invites.length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-sm font-medium">Admins</p>
          <p className="text-2xl font-bold text-foreground mt-2">
            {teamMembers.filter((m: any) => m.role === 'admin').length}
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
            {allMembers.map((member: any) => (
              <TableRow
                key={member._id || member.id}
                className="border-b border-border hover:bg-secondary/50 transition-colors"
              >
                <TableCell className="text-foreground font-medium">{member.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{member.email}</TableCell>
                <TableCell>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getRoleColor(
                      member.role
                    )}`}
                  >
                    {member.role ? (member.role.charAt(0).toUpperCase() + member.role.slice(1)) : 'User'}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(member.createdAt || Date.now()).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {member.lastActive}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={member.status === 'pending' ? 'pending' : 'active'}
                  />
                </TableCell>
                <TableCell>
                  {member.role !== 'admin' && member.status === 'active' && (
                    <button
                      onClick={() => handleRemoveMember(member._id || member.id)}
                      className="text-destructive hover:text-red-400 p-2 hover:bg-destructive/10 rounded transition-colors"
                      title="Remove member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Empty State */}
      {allMembers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No team members yet</p>
        </div>
      )}
    </div>
  );
}
