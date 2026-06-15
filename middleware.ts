import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/",
]);

const isTokenProtectedRoute = createRouteMatcher([
  "/team(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Check if this is a token-protected route
  if (isTokenProtectedRoute(req)) {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    
    // If no token is provided, protect the route normally
    if (!token) {
      await auth.protect();
      return;
    }
    
    // If token is provided, still require authentication but allow token validation
    // The actual token validation will happen on the client side
    await auth.protect();
    return;
  }
  
  // For other protected routes, use normal protection
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
})

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};