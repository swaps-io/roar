import { createPublicClient, createWalletClient, http } from 'viem';

import { CHAINS } from './chains';
import { CHAIN_ID_KEY, RPC_URL_ID_SUBSTITUTION } from './constant';
import { joinPath } from './file';
import { loadLock, saveLock } from './lock';
import { ChainClients, ConfigRpc, Deployer, Lock, Plan } from './type';
import { joinComma } from './util';

const DEFAULT_ID = -1;
const DEFAULT_URL = undefined; // Use Viem's default
const DEFAULT_SHOW = false; // For custom RPC URLs
const DEFAULT_VIEM_SHOW = true;

export const resolveChainClients = async (
  rpc: ConfigRpc,
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

  const urls = new Map<number, string>();
  const shows = new Map<number, boolean>();
  for (const [name, value] of Object.entries(rpc)) {
    switch (name) {
      case 'url':
        if (typeof value === 'string') {
          urls.set(DEFAULT_ID, value);
        }
        continue;

      case 'show':
        if (typeof value === 'boolean') {
          shows.set(DEFAULT_ID, value);
        }
        continue;
    }

    if (typeof value === 'object') {
      if (urls.has(value.id) || shows.has(value.id)) {
        throw new Error(`Multiple RPC configs specified for chain "${value.id}"`);
      }

      if (value.url != null) {
        urls.set(value.id, value.url);
      }
      if (value.show != null) {
        shows.set(value.id, value.show);
      }
    }
  }

  const getUrl = (id: number): string | undefined => {
    return urls.get(id) ?? urls.get(DEFAULT_ID) ?? DEFAULT_URL;
  };

  const getShow = (id: number): boolean => {
    return shows.get(id) ?? shows.get(DEFAULT_ID) ?? DEFAULT_SHOW;
  };

  const chainClients = new Map<string, ChainClients>();
  for (const [chainName, chainPlan] of chainPlans) {
    // Chain ID key presence and registry existence are validated in `extractChainPlans`.
    const id = chainPlan[CHAIN_ID_KEY] as number;
    const chain = CHAINS.get(id)!;

    let url = getUrl(id);
    if (url != null) {
      url = url.replaceAll(RPC_URL_ID_SUBSTITUTION, `${id}`);
    }

    const transport = http(url);
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
    const url = getUrl(chain.id);
    const show = url != null ? getShow(chain.id) : DEFAULT_VIEM_SHOW;

    let displayUrl = clients.public.transport.url;
    if (typeof displayUrl !== 'string') {
      throw new Error(`Unexpected "url" in chain "${chain.id}" transport (string expected)`);
    }

    if (!show) {
      displayUrl = '*'.repeat(displayUrl.length);
    }
    clients.public.transport.displayUrl = displayUrl;

    console.log(`- ${chainName}:`);
    console.log(`  - id: ${chain.id}`);
    console.log(`  - name: ${chain.name}`);
    console.log(`  - nonce: ${clients.nonce}`);
    console.log(`  - rpc: ${displayUrl}`);
  }
  return chainClients;
};
