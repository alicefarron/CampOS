import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string(),
  KAFKA_BROKERS: z.string().default("localhost:9092"),
});

export const config = schema.parse(process.env);
