/**
 * Zod schemas for Remotion compositions.
 * Adding these to <Composition schema={...}> enables the Props panel and the "JSON" button for pasting props.
 */

import { z } from "zod";

/** Session object (id, started_at, title, user_message, events). Events accepted as array of any for flexibility. */
export const SessionSchema = z.object({
  id: z.string(),
  started_at: z.string(),
  title: z.string(),
  user_message: z.string(),
  events: z.array(z.any()),
});

/** Props for FunReplay and SessionReplay. */
export const SessionReplaySchema = z.object({
  session: SessionSchema,
});

export type SessionReplaySchemaType = z.infer<typeof SessionReplaySchema>;
