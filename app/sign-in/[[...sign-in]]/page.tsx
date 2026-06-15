'use client';

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url");
  const decoded = redirectUrl ? decodeURIComponent(redirectUrl) : null;

  const token = decoded
  ? new URL(decoded).searchParams.get("token")
  : null;


  useEffect(() => {
    if (token && typeof window !== 'undefined') {
      sessionStorage.setItem('inviteToken', token);
    }
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="w-full max-w-md">
        <SignIn 
          forceRedirectUrl={token ? "/" : undefined}
        />
      </div>
    </div>
  );
}