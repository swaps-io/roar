import { arbitrum, base, Chain, gnosis } from 'viem/chains';

export const CHAINS = new Map<string, Chain>([
  ['gnosis', gnosis],
  ['base', base],
  ['arbitrum', arbitrum],
]);
