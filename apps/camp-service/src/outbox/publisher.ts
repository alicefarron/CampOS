import { Kafka } from "kafkajs";
import type { Producer } from "kafkajs";

import { config } from "../config.js";

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (producer) return producer;

  const kafka = new Kafka({
    clientId: "camp-service",
    brokers: config.KAFKA_BROKERS.split(","),
  });

  producer = kafka.producer();
  await producer.connect();
  return producer;
}

export async function disconnectProducer(): Promise<void> {
  await producer?.disconnect();
  producer = null;
}
