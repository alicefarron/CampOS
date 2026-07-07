import { startNotificationConsumer } from "./consumer.js";
import { pg } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

async function main(): Promise<void> {
  await runMigrations();

  const stopConsumer = await startNotificationConsumer();

  const shutdown = async () => {
    await stopConsumer();
    await pg.end();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  console.log("[notification-service] listening for events");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
