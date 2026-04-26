import { SignInForm } from '@/components/auth/signin-form';

export const metadata = {
  title: 'Sign In - SIRz Admin',
  description: 'Sign in to your SIRz account',
};

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <SignInForm />
    </div>
  );
}
