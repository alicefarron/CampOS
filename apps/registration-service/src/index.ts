import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startActivityCancelledConsumer } from "./consumers/activity-cancelled.js";
import { startCampConsumer } from "./consumers/camp-created.js";
import { pg } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { disconnectProducer } from "./outbox/publisher.js";
import { resetStuckEvents, startOutboxRelay } from "./outbox/relay.js";

async function main(): Promise<void> {
  await runMigrations();
  await resetStuckEvents();

  const stopCampConsumer = await startCampConsumer();
  const stopActivityCancelledConsumer = await startActivityCancelledConsumer();
  const app = buildApp();
  const relayTimer = startOutboxRelay();

  const shutdown = async () => {
    clearInterval(relayTimer);
    await stopCampConsumer();
    await stopActivityCancelledConsumer();
    await disconnectProducer();
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
