import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  KAFKA_BROKERS: z.string().default("localhost:9092"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(1000),
});

export const config = schema.parse(process.env);
