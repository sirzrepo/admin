'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Mail, Lock, Loader2, Chrome } from 'lucide-react';
import { useAuthActions } from '@convex-dev/auth/react';
import { extractAuthError } from '@/lib/auth-errors';
import { useAuth } from '@/hooks/useAuth';

export function SignInForm() {
  const router = useRouter();
  const { signIn } = useAuth();
  // const { signIn } = useAuthActions();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // try {
    //   // Validation
    //   if (!email || !password) {
    //     setError('Please enter both email and password');
    //     return;
    //   }

    //   if (!email.includes('@')) {
    //     setError('Please enter a valid email address');
    //     return;
    //   }

    //   await signIn("password", { email, password, flow: "signIn" });
    //   router.push('/');
    // } catch (err) {
    //   setError(err instanceof Error ? err.message : 'Sign in failed');
    // } finally {
    //   setIsLoading(false);
    // }

    try{
      await signIn("password",{
        email,
        password,
        flow:"signIn"
      });

      router.push("/");

    }catch(err){
      setError(extractAuthError(err));
    }finally{
      setIsLoading(false);
    }

  };

  // const handleGoogleSignIn = async () => {
  //   setError('');
  //   setIsLoading(true);
  //   try {
  //     // await signInWithGoogle();
  //     router.push('/');
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Google sign in failed');
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const handleGoogleSignIn = async ()=>{
    try{
      sessionStorage.setItem("isOAuthFlow","true");
      await signIn("google");
    }catch(err){
      setError(extractAuthError(err));
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold text-foreground">Welcome Back</h1>
        <p className="text-muted-foreground">Sign in to your SIRz account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Email Field */}
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
            />
          </div>
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
            />
          </div>
        </div>

        {/* Forgot Password Link */}
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-primary hover:text-accent transition">
            Forgot password?
          </Link>
        </div>

        {/* Sign In Button */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg transition flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border"></div>
        <span className="text-xs text-muted-foreground">OR</span>
        <div className="flex-1 h-px bg-border"></div>
      </div>

      {/* Google Sign In */}
      <Button
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        variant="outline"
        className="w-full flex items-center justify-center gap-2 py-2 border border-border hover:bg-secondary transition"
      >
        <Chrome className="w-4 h-4" />
        Sign in with Google
      </Button>

      {/* Sign Up Link */}
      <p className="text-center text-muted-foreground text-sm">
        Don't have an account?{' '}
        <Link href="/auth/signup" className="text-primary hover:text-accent transition font-medium">
          Sign up
        </Link>
      </p>
    </div>
  );
}
