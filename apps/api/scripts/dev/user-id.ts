/**
 * Print the user id for an email (dev only).
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/user-id.ts <email>
 */
import { withContainer } from "./bootstrap.js";

const email = process.argv[2];
if (!email) {
  console.error("usage: user-id.ts <email>");
  process.exit(2);
}

await withContainer(async (c) => {
  const user = await c.repos.users.findByEmailInsensitive(email);
  console.log(user ? user.id : `no user with email ${email}`);
});
