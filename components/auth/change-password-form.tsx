// 'use client';

// import React, { useState } from 'react';
// import { Button } from '@/components/ui/button';
// import { Lock, Loader2, Check, X } from 'lucide-react';
// import { useAuth } from '@/hooks/useAuth';

// export function ChangePasswordForm() {
//   const { changePassword } = useAuth();
//   const [currentPassword, setCurrentPassword] = useState('');
//   const [newPassword, setNewPassword] = useState('');
//   const [confirmPassword, setConfirmPassword] = useState('');
//   const [error, setError] = useState('');
//   const [success, setSuccess] = useState('');
//   const [isLoading, setIsLoading] = useState(false);

//   const passwordRequirements = {
//     minLength: newPassword.length >= 8,
//     hasUpperCase: /[A-Z]/.test(newPassword),
//     hasLowerCase: /[a-z]/.test(newPassword),
//     hasNumber: /[0-9]/.test(newPassword),
//   };

//   const isPasswordStrong = Object.values(passwordRequirements).every(Boolean);
//   const passwordsMatch = newPassword === confirmPassword && newPassword.length > 0;

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
//     setError('');
//     setSuccess('');
//     setIsLoading(true);

//     try {
//       if (!currentPassword || !newPassword || !confirmPassword) {
//         setError('Please fill in all fields');
//         return;
//       }

//       if (!isPasswordStrong) {
//         setError('New password does not meet requirements');
//         return;
//       }

//       if (newPassword !== confirmPassword) {
//         setError('New passwords do not match');
//         return;
//       }

//       if (currentPassword === newPassword) {
//         setError('New password must be different from current password');
//         return;
//       }

//       await changePassword(currentPassword, newPassword);
//       setSuccess('Password changed successfully');
//       setCurrentPassword('');
//       setNewPassword('');
//       setConfirmPassword('');
//     } catch (err) {
//       setError(err instanceof Error ? err.message : 'Failed to change password');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <div className="w-full max-w-md space-y-6">
//       <div className="space-y-2">
//         <h2 className="text-2xl font-bold text-foreground">Change Password</h2>
//         <p className="text-muted-foreground">Update your account password</p>
//       </div>

//       <form onSubmit={handleSubmit} className="space-y-4">
//         {error && (
//           <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm">
//             {error}
//           </div>
//         )}

//         {success && (
//           <div className="bg-chart-2/10 border border-chart-2/30 text-chart-2 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
//             <Check className="w-4 h-4" />
//             {success}
//           </div>
//         )}

//         {/* Current Password Field */}
//         <div className="space-y-2">
//           <label htmlFor="currentPassword" className="block text-sm font-medium text-foreground">
//             Current Password
//           </label>
//           <div className="relative">
//             <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
//             <input
//               id="currentPassword"
//               type="password"
//               value={currentPassword}
//               onChange={(e) => setCurrentPassword(e.target.value)}
//               placeholder="••••••••"
//               className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
//             />
//           </div>
//         </div>

//         {/* New Password Field */}
//         <div className="space-y-2">
//           <label htmlFor="newPassword" className="block text-sm font-medium text-foreground">
//             New Password
//           </label>
//           <div className="relative">
//             <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
//             <input
//               id="newPassword"
//               type="password"
//               value={newPassword}
//               onChange={(e) => setNewPassword(e.target.value)}
//               placeholder="••••••••"
//               className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
//             />
//           </div>

//           {/* Password Requirements */}
//           {newPassword && (
//             <div className="bg-secondary p-3 rounded-lg border border-border space-y-2 mt-2">
//               <p className="text-xs font-medium text-foreground mb-2">Password requirements:</p>
//               <div className="grid grid-cols-2 gap-2 text-xs">
//                 <div className="flex items-center gap-2">
//                   {passwordRequirements.minLength ? (
//                     <Check className="w-4 h-4 text-chart-2" />
//                   ) : (
//                     <X className="w-4 h-4 text-destructive" />
//                   )}
//                   <span className={passwordRequirements.minLength ? 'text-foreground' : 'text-muted-foreground'}>
//                     At least 8 characters
//                   </span>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   {passwordRequirements.hasUpperCase ? (
//                     <Check className="w-4 h-4 text-chart-2" />
//                   ) : (
//                     <X className="w-4 h-4 text-destructive" />
//                   )}
//                   <span className={passwordRequirements.hasUpperCase ? 'text-foreground' : 'text-muted-foreground'}>
//                     Uppercase letter
//                   </span>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   {passwordRequirements.hasLowerCase ? (
//                     <Check className="w-4 h-4 text-chart-2" />
//                   ) : (
//                     <X className="w-4 h-4 text-destructive" />
//                   )}
//                   <span className={passwordRequirements.hasLowerCase ? 'text-foreground' : 'text-muted-foreground'}>
//                     Lowercase letter
//                   </span>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   {passwordRequirements.hasNumber ? (
//                     <Check className="w-4 h-4 text-chart-2" />
//                   ) : (
//                     <X className="w-4 h-4 text-destructive" />
//                   )}
//                   <span className={passwordRequirements.hasNumber ? 'text-foreground' : 'text-muted-foreground'}>
//                     Number
//                   </span>
//                 </div>
//               </div>
//             </div>
//           )}
//         </div>

//         {/* Confirm Password Field */}
//         <div className="space-y-2">
//           <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
//             Confirm New Password
//           </label>
//           <div className="relative">
//             <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
//             <input
//               id="confirmPassword"
//               type="password"
//               value={confirmPassword}
//               onChange={(e) => setConfirmPassword(e.target.value)}
//               placeholder="••••••••"
//               className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary transition"
//             />
//           </div>
//           {confirmPassword && (
//             <div className="flex items-center gap-2 text-xs mt-1">
//               {passwordsMatch ? (
//                 <>
//                   <Check className="w-4 h-4 text-chart-2" />
//                   <span className="text-foreground">Passwords match</span>
//                 </>
//               ) : (
//                 <>
//                   <X className="w-4 h-4 text-destructive" />
//                   <span className="text-destructive">Passwords do not match</span>
//                 </>
//               )}
//             </div>
//           )}
//         </div>

//         {/* Submit Button */}
//         <Button
//           type="submit"
//           disabled={isLoading || !isPasswordStrong || !passwordsMatch}
//           className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
//         >
//           {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
//           {isLoading ? 'Changing Password...' : 'Change Password'}
//         </Button>
//       </form>
//     </div>
//   );
// }
