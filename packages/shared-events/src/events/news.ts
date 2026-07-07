import type { KafkaEvent } from "../base.js";

export const NEWS_EVENT_TYPES = {
  NEWS_PUBLISHED: "NewsPublished",
} as const;

export interface NewsPublishedPayload {
  newsId: string;
  title: string;
  authorId: string;
  publishedAt: string;
}

export type NewsPublishedEvent = KafkaEvent<"NewsPublished", NewsPublishedPayload>;

export type NewsEvent = NewsPublishedEvent;
