// Thrown by channel adapters when the upstream rejected the message in a way
// that retrying cannot fix (e.g. user blocked the bot, chat not found).
// The dispatcher acks these instead of burning the retry budget.
export class PermanentChannelError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PermanentChannelError';
    this.status = status;
  }
}
