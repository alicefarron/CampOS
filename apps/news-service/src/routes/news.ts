import { NEWS_EVENT_TYPES, TOPICS } from "@campost/shared-events";
import type { NewsPublishedEvent } from "@campost/shared-events";
import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { db } from "../db/client.js";
import { news, outboxEvents } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type News = InferSelectModel<typeof news>;

class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND",
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  authorId: z.string().min(1),
  status: z.enum(["draft", "published"]).default("draft"),
});

const PatchBody = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
    status: z.enum(["draft", "published"]),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field required" });

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildNewsPublishedEvent(article: News): NewsPublishedEvent {
  return {
    eventId: randomUUID(),
    eventType: NEWS_EVENT_TYPES.NEWS_PUBLISHED,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      newsId: article.id,
      title: article.title,
      authorId: article.authorId,
      publishedAt: (article.publishedAt ?? new Date()).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /news
   *
   * Creates a news article. If status is "published", emits NewsPublished
   * via the Outbox in the same transaction.
   */
  app.post("/news", {
    schema: {
      tags: ["News"],
      summary: "Create a news article",
      body: {
        type: "object",
        required: ["title", "body", "authorId"],
        properties: {
          title: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          authorId: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["draft", "published"], default: "draft" },
        },
      },
    },
  }, async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", issues: parsed.error.issues });
    }

    const { title, body: bodyText, authorId, status } = parsed.data;
    const isPublishing = status === "published";

    const article = await db.transaction(async (tx) => {
      const publishedAt = isPublishing ? new Date() : null;

      const [created] = await tx
        .insert(news)
        .values({
          title,
          body: bodyText,
          authorId,
          status,
          ...(publishedAt !== null && { publishedAt }),
        })
        .returning() as [News, ...News[]];

      if (isPublishing) {
        const event = buildNewsPublishedEvent(created);
        await tx.insert(outboxEvents).values({
          eventType: event.eventType,
          topic: TOPICS.NEWS,
          payload: event as unknown as Record<string, unknown>,
        });
      }

      return created;
    });

    return reply.status(201).send(article);
  });

  /**
   * GET /news
   *
   * Returns all news articles, optionally filtered by status.
   * ?status=published | draft
   */
  app.get<{ Querystring: { status?: string } }>("/news", {
    schema: {
      tags: ["News"],
      summary: "List news articles",
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "published"], description: "Filter by status" },
        },
      },
    },
  }, async (request, reply) => {
    const { status } = request.query;

    const rows = status
      ? await db.select().from(news).where(eq(news.status, status))
      : await db.select().from(news);

    return reply.send(rows);
  });

  /**
   * PATCH /news/:id
   *
   * Partial update. If status transitions to "published" for the first time,
   * sets publishedAt and emits NewsPublished via the Outbox.
   */
  app.patch<{ Params: { id: string } }>("/news/:id", {
    schema: {
      tags: ["News"],
      summary: "Update a news article",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        minProperties: 1,
        properties: {
          title: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["draft", "published"] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const parsed = PatchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", issues: parsed.error.issues });
    }

    const patch = parsed.data;

    try {
      const article = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(news).where(eq(news.id, id));
        if (!existing) throw new AppError("News article not found", "NOT_FOUND");

        const isPublishing = patch.status === "published" && existing.status !== "published";

        const [updated] = await tx
          .update(news)
          .set({
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.body !== undefined && { body: patch.body }),
            ...(patch.status !== undefined && { status: patch.status }),
            ...(isPublishing && { publishedAt: new Date() }),
            updatedAt: new Date(),
          })
          .where(eq(news.id, id))
          .returning() as [News, ...News[]];

        if (isPublishing) {
          const event = buildNewsPublishedEvent(updated);
          await tx.insert(outboxEvents).values({
            eventType: event.eventType,
            topic: TOPICS.NEWS,
            payload: event as unknown as Record<string, unknown>,
          });
        }

        return updated;
      });

      return reply.send(article);
    } catch (err: unknown) {
      if (err instanceof AppError && err.code === "NOT_FOUND") {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });
}
