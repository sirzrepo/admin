import SignUpFormPage from "@/components/auth/signup-form";



export const metadata = {
  title: 'Sign Up - SIRz Admin',
  description: 'Create a new SIRz account',
};

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <SignUpFormPage />
    </div>
  );
}
