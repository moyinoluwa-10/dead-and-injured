import { z } from "zod";
import { MAX_USERNAME_LENGTH, ROOM_CODE_LENGTH } from "../shared/protocol";

/** Runtime validation for everything a client can send. Game-rule validation lives in Match. */
export const authSchema = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  token: z.string().min(8).max(64),
});

export const idSchema = z.string().min(1).max(64);
export const respondSchema = z.tuple([idSchema, z.boolean()]);
export const digitsSchema = z.string().max(16);
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`));

/** The parsed value, or undefined if it is not valid. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}
