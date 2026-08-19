const DEFAULT_REPLAY_CAPACITY = 10_000;

export type ReplayStore = {
  consume(jti: string, expiresAt: number): boolean;
};

export type InMemoryReplayStoreOptions = {
  capacity?: number;
  clock?: () => number;
};

export class InMemoryReplayStore implements ReplayStore {
  readonly #capacity: number;
  readonly #clock: () => number;
  readonly #entries = new Map<string, number>();

  constructor(options: InMemoryReplayStoreOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_REPLAY_CAPACITY;
    this.#clock = options.clock ?? Date.now;

    if (!Number.isInteger(this.#capacity) || this.#capacity < 1) {
      throw new RangeError('Replay store capacity must be a positive integer');
    }
  }

  consume(jti: string, expiresAt: number): boolean {
    const now = this.#clock();

    for (const [entryJti, entryExpiresAt] of this.#entries) {
      if (now >= entryExpiresAt) {
        this.#entries.delete(entryJti);
      }
    }

    if (this.#entries.has(jti)) {
      return false;
    }
    if (this.#entries.size >= this.#capacity) {
      throw new Error('Replay store capacity reached');
    }

    this.#entries.set(jti, expiresAt);
    return true;
  }
}
