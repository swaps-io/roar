import * as chains from 'viem/chains';

export const CHAINS = new Map<number, chains.Chain>(
  Object.values(chains)
    .filter((chain) => 'id' in chain)
    .map((chain) => [chain.id, chain]),
);
