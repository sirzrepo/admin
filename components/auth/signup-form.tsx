'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// import { useAuthActions } from '@convex-dev/auth/react';
import { Button } from '@/components/ui/button';
import { Mail, Lock, Loader2, Chrome, Check, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { extractAuthError } from '@/lib/auth-errors';

export function SignUpForm() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const passwordRequirements = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };

  const isPasswordStrong = Object.values(passwordRequirements).every(Boolean);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   setError('');
  //   setIsLoading(true);

  //   try {
  //     // Validation
  //     if (!email || !password || !confirmPassword) {
  //       setError('Please fill in all fields');
  //       return;
  //     }

  //     if (!email.includes('@')) {
  //       setError('Please enter a valid email address');
  //       return;
  //     }

  //     if (!isPasswordStrong) {
  //       setError('Password does not meet requirements');
  //       return;
  //     }

  //     if (password !== confirmPassword) {
  //       setError('Passwords do not match');
  //       return;
  //     }

  //     await signIn("password", { email, password, flow: "signUp" });
  //     router.push('/');
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Sign up failed');
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  // const handleGoogleSignUp = async () => {
  //   setError('');
  //   setIsLoading(true);
  //   try {
  //     await signIn("google", { flow: "signUp" });
  //     router.push('/');
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Google sign up failed');
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if(password !== confirmPassword){
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try{
      await signIn("password",{
        email,
        password,
        flow:"signUp"
      });

      router.push("/");

    }catch(err){
      setError(extractAuthError(err));
    }finally{
      setIsLoading(false);
    }
  };

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
        <h1 className="text-3xl font-bold text-foreground">Create Account</h1>
        <p className="text-muted-foreground">Join SIRz to get started</p>
      </div>

      <form 
      onSubmit={handleSubmit} 
      className="space-y-4">
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

          {/* Password Requirements */}
          {password && (
            <div className="bg-secondary p-3 rounded-lg border border-border space-y-2 mt-2">
              <p className="text-xs font-medium text-foreground mb-2">Password requirements:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  {passwordRequirements.minLength ? (
                    <Check className="w-4 h-4 text-chart-2" />
                  ) : (
                    <X className="w-4 h-4 text-destructive" />
                  )}
                  <span className={passwordRequirements.minLength ? 'text-foreground' : 'text-muted-foreground'}>
                    At least 8 characters
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {passwordRequirements.hasUpperCase ? (
                    <Check className="w-4 h-4 text-chart-2" />
                  ) : (
                    <X className="w-4 h-4 text-destructive" />
                  )}
                  <span className={passwordRequirements.hasUpperCase ? 'text-foreground' : 'text-muted-foreground'}>
                    Uppercase letter
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {passwordRequirements.hasLowerCase ? (
                    <Check className="w-4 h-4 text-chart-2" />
                  ) : (
                    <X className="w-4 h-4 text-destructive" />
                  )}
                  <span className={passwordRequirements.hasLowerCase ? 'text-foreground' : 'text-muted-foreground'}>
                    Lowercase letter
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {passwordRequirements.hasNumber ? (
                    <Check className="w-4 h-4 text-chart-2" />
                  ) : (
                    <X className="w-4 h-4 text-destructive" />
                  )}
                  <span className={passwordRequirements.hasNumber ? 'text-foreground' : 'text-muted-foreground'}>
                    Number
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password Field */}
        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
            />
          </div>
          {confirmPassword && (
            <div className="flex items-center gap-2 text-xs mt-1">
              {passwordsMatch ? (
                <>
                  <Check className="w-4 h-4 text-chart-2" />
                  <span className="text-foreground">Passwords match</span>
                </>
              ) : (
                <>
                  <X className="w-4 h-4 text-destructive" />
                  <span className="text-destructive">Passwords do not match</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Sign Up Button */}
        <Button
          type="submit"
          disabled={isLoading || !isPasswordStrong || !passwordsMatch}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isLoading ? 'Creating Account...' : 'Sign Up'}
        </Button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border"></div>
        <span className="text-xs text-muted-foreground">OR</span>
        <div className="flex-1 h-px bg-border"></div>
      </div>

      {/* Google Sign Up */}
      <Button
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        variant="outline"
        className="w-full flex items-center justify-center gap-2 py-2 border border-border hover:bg-secondary transition"
      >
        <Chrome className="w-4 h-4" />
        Sign up with Google
      </Button>

      {/* Sign In Link */}
      <p className="text-center text-muted-foreground text-sm">
        Already have an account?{' '}
        <Link href="/auth/signin" className="text-primary hover:text-accent transition font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
