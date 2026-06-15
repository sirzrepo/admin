'use client';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { usePathname } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../convex/_generated/api';

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith('/auth');
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn } = useUser();

  console.log("isLoaded", isLoaded)
  console.log("isSignedIn", isSignedIn)

  const syncUser = useMutation(api.teams.syncMemberFromClerk);
  const acceptInvite = useMutation(api.invites.acceptInvitation);

  const [isSynced, setIsSynced] = useState(false);
  const [inviteProcessed, setInviteProcessed] = useState(false);

    // 👇 get token from sessionStorage (set earlier from sign-in page)
  const token =
    typeof window !== "undefined"
      ? sessionStorage.getItem("inviteToken")
      : null;

  const authCheck = useQuery(
    api.teams.checkUserAuthorization,
    isSynced && inviteProcessed ? {} : "skip"
  );

    // 🔥 STEP 1: Sync user
  useEffect(() => {
    if (isSignedIn && !isSynced) {
      syncUser()
        .then(() => setIsSynced(true))
        .catch(() => {
          toast.error("User sync failed");
          signOut(() => {
            window.location.href = "/sign-in";
          });
        });
    }
  }, [isSignedIn, isSynced]);

    // 🔥 STEP 2: Accept invite (ONLY once)
  useEffect(() => {
    if (isSignedIn && isSynced && token && !inviteProcessed) {
      acceptInvite({ token })
        .then(() => {
          sessionStorage.removeItem("inviteToken"); // prevent re-use
          setInviteProcessed(true);
        })
        .catch((err) => {
          console.error(err);
          toast.error("Invite processing failed");
          setInviteProcessed(true); // still allow flow
        });
    }

    // If no token, mark as processed
    if (isSignedIn && isSynced && !token && !inviteProcessed) {
      setInviteProcessed(true);
    }
  }, [isSignedIn, isSynced, token, inviteProcessed]);

    // 🔒 STEP 3: Handle unauthorized
  useEffect(() => {
    if (isSignedIn && authCheck && !authCheck.authorized) {
      toast.error(`Unauthorized access: ${authCheck.reason}`);

      const timer = setTimeout(() => {
        signOut(() => {
          window.location.href = "/sign-in";
        });
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isSignedIn, authCheck]);

    // ⏳ Clerk loading
  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  // 🔓 Not signed in
  if (!isSignedIn) {
    return <>{children}</>;
  }

  // ⏳ Wait for sync + invite
  if (!isSynced || !inviteProcessed) {
    return <div className="min-h-screen flex items-center justify-center">Setting up your account</div>;
  }

  // ⏳ Wait for auth check
  if (authCheck === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Checking authorization...</div>;
  }

    // ✅ Authorized
  if (authCheck.authorized) {
    return (
      <main className="pl-20 pt-16 md:pl-64">
        <Sidebar />
        <Header />
        {children}
      </main>
    );
  }

  // ❌ Unauthorized
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Unauthorized Access</h2>
        <p className="text-muted-foreground">{authCheck.reason}</p>
      </div>
    </div>
  );
}
