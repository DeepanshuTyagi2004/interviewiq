import { MongoMemoryServer } from "mongodb-memory-server";
import type { GlobalSetupContext } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** One in-memory mongod for the whole run; each test file uses its own database on it. */
export default async function setup({ provide }: GlobalSetupContext) {
  const mongod = await MongoMemoryServer.create();
  provide("mongoUri", mongod.getUri());
  return async () => {
    await mongod.stop();
  };
}
