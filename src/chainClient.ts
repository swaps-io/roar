import { createPublicClient, createWalletClient, http } from 'viem';

import { CHAINS } from './chains';
import { CHAIN_ID_KEY } from './constant';
import { joinPath } from './file';
import { loadLock, saveLock } from './lock';
import { ChainClients, Deployer, Lock, Plan } from './type';
import { joinComma } from './util';

export const resolveChainClients = async (
  deployer: Deployer,
  chainPlans: ReadonlyMap<string, Plan>,
  locksPath: string,
  planPath: string,
): Promise<Map<string, ChainClients>> => {
  const lockPath = joinPath(locksPath, planPath);
  const lock = await loadLock(lockPath);

  if (lock != null) {
    const lockChainItems = Object.keys(lock.nonces).sort();
    const lockChains = joinComma(lockChainItems);

    const planChainItems = [...chainPlans.keys()].sort();
    const planChains = joinComma(planChainItems);

    if (lockChains !== planChains) {
      throw new Error(
        `Lock "${lockPath}" chains "${lockChains}" (${lockChainItems.length}) ` +
          `are not the same as the plan chains "${planChains}" (${planChainItems.length})`,
      );
    }
  }

  const chainClients = new Map<string, ChainClients>();
  for (const [chainName, chainPlan] of chainPlans) {
    // Chain ID key presence and registry existence are validated in `extractChainPlans`.
    const id = chainPlan[CHAIN_ID_KEY] as number;
    const chain = CHAINS.get(id)!;

    const transport = http();
    const publicClient = createPublicClient({
      chain,
      transport,
    });
    const walletClient = createWalletClient({
      account: deployer,
      chain,
      transport,
    });

    const clients: ChainClients = {
      wallet: walletClient,
      public: publicClient,
      nonce: -1,
    };
    chainClients.set(chainName, clients);
  }

  if (lock == null) {
    const newLock: Lock = {
      nonces: {},
    };

    await Promise.all(
      chainClients.entries().map(async ([chainName, clients]) => {
        clients.nonce = await clients.public.getTransactionCount({ address: deployer.address });
        newLock.nonces[chainName] = clients.nonce;
      }),
    );

    await saveLock(lockPath, newLock);
  } else {
    for (const [chainName, clients] of chainClients) {
      clients.nonce = lock.nonces[chainName];
    }
  }

  console.log();
  console.log(`Chain clients (${chainClients.size}):`);
  for (const [chainName, clients] of chainClients) {
    const chain = clients.public.chain;
    console.log(`- ${chainName}:`);
    console.log(`  - id: ${chain.id}`);
    console.log(`  - name: ${chain.name}`);
    console.log(`  - nonce: ${clients.nonce}`);
    console.log(`  - rpcs: ${joinComma(chain.rpcUrls.default.http)}`);
  }
  return chainClients;
};
