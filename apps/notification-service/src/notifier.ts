/**
 * A single notification to deliver to a recipient.
 *
 * `recipient` is a human-readable audience label (e.g. `participant <id>` or
 * `participants of activity <id>`) rather than a resolved address — this
 * service does not yet own contact details, so it describes *who* should be
 * notified and leaves *how* to the concrete {@link Notifier}.
 */
export interface Notification {
  recipient: string;
  subject: string;
  body: string;
}

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

/**
 * Development notifier — writes notifications to the log instead of sending
 * them. Swap for an email/SMS implementation without touching the consumer.
 */
export class LogNotifier implements Notifier {
  send(notification: Notification): Promise<void> {
    console.log(
      `[notifier] Sending notification to ${notification.recipient} — ${notification.subject}`,
    );
    console.log(`[notifier]   ${notification.body}`);
    return Promise.resolve();
  }
}
