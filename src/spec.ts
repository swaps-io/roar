import { createFileDirectory, saveYaml } from './file';
import { Action, Args, ChainActionsSpec, ChainClients, Deployer, PlanSpec } from './type';

export const generatePlanSpec = (
  args: Args,
  deployer: Deployer,
  chainClients: ReadonlyMap<string, ChainClients>,
  chainActions: ReadonlyMap<string, Action[]>,
): PlanSpec => {
  const spec: PlanSpec = {
    args: {
      plan: args.planPath,
      config: args.configPath,
      artifacts: args.artifactsPath,
      locks: args.locksPath,
      spec: args.specPath,
    },
    deployer: {
      address: deployer.address,
    },
    chains: {},
  };

  for (const [chainName, actions] of chainActions) {
    const clients = chainClients.get(chainName)!;

    const chainSpec: ChainActionsSpec = {
      chain: {
        id: clients.public.chain.id,
        key: chainName,
        name: clients.public.chain.name,
        rpcs: clients.public.chain.rpcUrls.default.http,
      },
      deployer: {
        address: clients.wallet.account.address,
        nonce: clients.nonce,
      },
      actions,
    };
    spec.chains[chainName] = chainSpec;
  }
  return spec;
};

export const savePlanSpec = async (path: string, spec: PlanSpec): Promise<void> => {
  console.log();
  console.log('Plan spec save:');
  console.log(`- path: ${path}`);

  await createFileDirectory(path);
  await saveYaml(path, spec);
  console.log('- status: saved 💾');
};
