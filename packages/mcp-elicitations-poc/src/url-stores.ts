import { randomUUID } from 'node:crypto';

export type Interaction = {
  id: string;
  principal: string;
  tool: string;
  argsDigest: string;
  status: 'pending' | 'complete';
  exp: number;
};

export interface InteractionStore {
  create(i: Omit<Interaction, 'status'>): Interaction;
  get(id: string): Interaction | undefined;
  complete(id: string): boolean;
  consume(id: string): boolean;
}

export class InMemoryInteractionStore implements InteractionStore {
  readonly #items = new Map<string, Interaction>();
  readonly #consumed = new Set<string>();
  readonly #clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.#clock = clock;
  }

  create(i: Omit<Interaction, 'status'>): Interaction {
    const interaction: Interaction = { ...i, status: 'pending' };
    this.#items.set(i.id, interaction);
    return { ...interaction };
  }

  get(id: string): Interaction | undefined {
    const interaction = this.#items.get(id);
    if (!interaction || interaction.exp <= this.#clock()) return undefined;
    return { ...interaction };
  }

  complete(id: string): boolean {
    const interaction = this.#items.get(id);
    if (
      !interaction ||
      interaction.exp <= this.#clock() ||
      interaction.status !== 'pending'
    ) {
      return false;
    }
    interaction.status = 'complete';
    return true;
  }

  consume(id: string): boolean {
    const interaction = this.#items.get(id);
    if (
      !interaction ||
      interaction.exp <= this.#clock() ||
      interaction.status !== 'complete' ||
      this.#consumed.has(id)
    ) {
      return false;
    }
    this.#consumed.add(id);
    return true;
  }
}

export interface SecretStore {
  put(
    principal: string,
    name: string,
    value: string
  ): { ref: string; last4: string };
  get(
    principal: string,
    name: string
  ): { ref: string; last4: string } | undefined;
}

export class InMemorySecretStore implements SecretStore {
  readonly #items = new Map<
    string,
    { value: string; ref: string; last4: string }
  >();

  put(principal: string, name: string, value: string) {
    const stored = {
      value,
      ref: `secret_${randomUUID()}`,
      last4: value.slice(-4),
    };
    this.#items.set(JSON.stringify([principal, name]), stored);
    return { ref: stored.ref, last4: stored.last4 };
  }

  get(principal: string, name: string) {
    const stored = this.#items.get(JSON.stringify([principal, name]));
    return stored ? { ref: stored.ref, last4: stored.last4 } : undefined;
  }
}
