'use client';

import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();

  const forgotPassword = async (email: string) => {
    // TODO: Implement forgot password functionality
    // This would typically call an API endpoint or Convex mutation
    // to send a password reset email
    throw new Error('Forgot password functionality not yet implemented');
  };

  return {
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
    forgotPassword,
  };
}