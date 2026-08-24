import { bytesToBase64Url, type StateSigner } from './codec.js';

const INTERACTION_LABEL = 'mcp-interaction:v1|';

/**
 * Derives the Interaction ID that correlates every round, and every repeated
 * attempt, of one logical interaction.
 *
 * The input is the signed state's `jti`. The derivation is a keyed one-way
 * function, so a telemetry sink holding the Interaction ID cannot recover the
 * `jti` or forge state that carries it. `jti` exists for this derivation and
 * nothing else: it grants no single use and no production code reads it.
 */
export async function deriveInteractionId(
  signer: StateSigner,
  jti: string
): Promise<string> {
  return bytesToBase64Url(await signer.sign(INTERACTION_LABEL + jti));
}
