// export default {
//   providers: [
//     {
//       domain: process.env.CONVEX_CLERK_URL,
//       applicationID: "convex",
//     },
//   ],
// };


export default {
  providers: [
    {
      domain: process.env.CONVEX_CLERK_URL,
      applicationID: "convex",
    },
    {
      domain: process.env.SITE_URL,
      applicationID: "convex",
    },
  ],
};
