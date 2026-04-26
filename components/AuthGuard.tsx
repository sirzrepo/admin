'use client';

import { useAuth } from "@/hooks/useAuth";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

export function AuthGuard({children}:{children:React.ReactNode}){

  const {isAuthenticated,isLoading} = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage = pathname.startsWith("/auth");

  useEffect(()=>{
    if(!isLoading && !isAuthenticated && !isAuthPage){
      router.replace("/auth/signin");
    }
  },[isLoading,isAuthenticated,router, isAuthPage]);

  if(isLoading && !isAuthPage){
    return (
      <div className="h-screen flex items-center justify-center">
        Loading...,,,,
      </div>
    );
  }

  if(!isAuthenticated && !isAuthPage){
    return null;
  }

  return children;
}