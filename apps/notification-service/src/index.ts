import { buildApp } from "./app.js";
import { startNotificationConsumer } from "./consumer.js";
import { config } from "./config.js";
import { pg } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

async function main(): Promise<void> {
  await runMigrations();

  const stopConsumer = await startNotificationConsumer();
  const app = buildApp();

  const shutdown = async () => {
    await stopConsumer();
    await app.close();
    await pg.end();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
