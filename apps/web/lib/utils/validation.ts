import { z } from "zod";

export const emailSchema = z.string().email();
export const passwordSchema = z.string().min(8);

export type Email = z.infer<typeof emailSchema>;
