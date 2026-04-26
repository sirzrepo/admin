"use client"



// app/auth/signup/page.tsx
import { Suspense } from "react";
import { SignUpForm } from "./signupForm";

export default function SignUpFormPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignUpForm />
    </Suspense>
  );
}
