import NextAuth from "next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    // TODO: add providers (Credentials, OAuth)
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});
