import fs from 'fs/promises';
import yaml from 'js-yaml';

import {
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  getCreateAddress,
  Hex,
  http,
  isAddressEqual,
  isHex,
  PrivateKeyAccount,
  PublicClient,
  Transport,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base, gnosis } from 'viem/chains';

const CHAINS = new Map<string, Chain>([
  ['gnosis', gnosis],
  ['base', base],
  ['arbitrum', arbitrum],
]);

const DEFAULT_PLAN_PATH = 'plan.yaml';
const DEFAULT_CONFIG_PATH = 'config.yaml';

const CALL_PREFIX = '$';
const CALL_TARGET = '$';
const REFERENCE_PREFIX = '$';
const REFERENCE_SEPARATOR = '.';

const RETRY_DELAY = 8_000; // 8s
const NONCE_BEHIND_RETRIES = 15; // * 8s = 2m

type Args = {
  planPath: string,
  configPath: string,
};

type ConfigDeployer = {
  key: Hex,
};

type Config = {
  deployer: ConfigDeployer,
};

type PlanElement = string | number | boolean | null | PlanElement[] | { [key: string]: PlanElement };
type Plan = { [key: string]: PlanElement };

type ChainClients = {
  wallet: WalletClient<Transport, Chain, PrivateKeyAccount>,
  public: PublicClient,
  nonce: number,
};

type DeployPath = { path: string[] };

type DeployStep = {
  type: 'deploy',
  name: string,
  path: string[],
  args: Record<string, string | DeployPath>,
};

type CallStep = {
  type: 'call',
  name: string,
  target: string | DeployPath,
  args: Record<string, string | DeployPath>,
}

type Step = DeployStep | CallStep;

type Deploy = {
  index: number,
  address: string,
};

type Action = {
  nonce: number;
  to?: Hex;
  data: Hex;
};

const parseArgs = (): Args => {
  console.log();
  console.log('Roar 🏎️');
  console.log();

  const usage = (): never => {
    throw new Error(`Usage: roar [--plan <plan-path>] [--config <config-path>]`);
  };

  const args: Args = {
    configPath: DEFAULT_CONFIG_PATH,
    planPath: DEFAULT_PLAN_PATH,
  };

  const getArgValue = (index: number): string => {
    const value = process.argv[index];
    return value || usage();
  }

  const getArg = (index: number): void => {
    switch (process.argv[index]) {
      case '--plan':
      case '-p':
        args.planPath = getArgValue(index + 1);
        return;
      case '--config':
      case '-c':
        args.configPath = getArgValue(index + 1);
        return;
      default:
        usage();
    }
  };

  for (let index = 2; index < process.argv.length; index += 2) {
    getArg(index);
  }

  console.log(`Plan path: ${args.planPath}`);
  console.log(`Config path: ${args.configPath}`);
  return args;
};

const loadText = async (path: string): Promise<string> => {
  const text = await fs.readFile(path, 'utf-8');
  return text;
};

const loadYaml = async (path: string): Promise<unknown> => {
  const text = await loadText(path);
  const object = yaml.load(text);
  return object;
};

const loadConfig = async (path: string): Promise<Config> => {
  const config = await loadYaml(path);
  return config as Config;
};

const loadPlan = async (path: string): Promise<Plan> => {
  const plan = await loadYaml(path);
  return plan as Plan;
};

const verifyPlanDeployer = (deployer: PrivateKeyAccount, plan: Plan): void => {
  console.log();
  console.log(`Config deployer: ${deployer.address}`);

  if (plan.deployer == null) {
    console.log('No specific deployer expected by plan');
    return;
  }

  if (typeof plan.deployer !== 'string' || !isHex(plan.deployer)) {
    throw new Error('Plan deployer must be a hex string');
  }

  const match = isAddressEqual(plan.deployer, deployer.address);
  console.log(`Plan deployer: ${plan.deployer} ${match ? '✅' : '❌'}`);
  if (!match) {
    throw new Error('Config deployer does not match deployer expected by plan');
  }
};

const extractChainPlans = (plan: Plan): Map<string, Plan> => {
  const chainNames = Object.keys(plan).filter((key) => CHAINS.has(key));
  console.log(`Plan chains (${chainNames.length}): ${chainNames.join(', ')}`);

  const chainPlans = new Map<string, Plan>();
  for (const chainName of chainNames) {
    const chainPlan = plan[chainName];
    if (chainPlan == null || Array.isArray(chainPlan) || typeof chainPlan !== 'object') {
      throw new Error(`Invalid plan chain object named "${chainName}"`);
    }

    chainPlans.set(chainName, chainPlan);
  }
  return chainPlans;
};

const resolveChainClients = async (
  deployer: PrivateKeyAccount,
  chainPlans: ReadonlyMap<string, Plan>,
): Promise<Map<string, ChainClients>> => {
  const chainClients = new Map<string, ChainClients>();
  for (const chainName of chainPlans.keys()) {
    const chain = CHAINS.get(chainName)!;
    const transport = http();
    const publicClient = createPublicClient({
      chain,
      transport,
    })
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

  await Promise.all(chainClients.values().map(async (clients) => {
    clients.nonce = await clients.public.getTransactionCount({ address: deployer.address });
  }));

  console.log();
  console.log(`Chain clients (${chainClients.size}):`);
  for (const [chainName, clients] of chainClients) {
    const chain = CHAINS.get(chainName)!;
    console.log(`- ${chainName}:`);
    console.log(`  - id: ${chain.id}`);
    console.log(`  - nonce: ${clients.nonce}`);
    console.log(`  - rpc: ${chain.rpcUrls.default.http.join(', ')}`);
  }
  return chainClients;
};

const isUpperCase = (value: string): boolean => {
  return ( // 2 checks to handle digits etc
    value === value.toUpperCase() &&
    value !== value.toLowerCase()
  );
};

const isContract = (name: string): boolean => {
  const start = name.slice(0, 1); // First character
  return isUpperCase(start);
};

const isContractAddress = (value: unknown): value is Hex => {
  return isHex(value);
};

const isCall = (name: string): boolean => {
  return name.startsWith(CALL_PREFIX);
};

const resolveCall = (name: string): string => {
  return name.slice(CALL_PREFIX.length);
};

const isReference = (name: string): boolean => {
  return name.startsWith(REFERENCE_PREFIX);
};

const resolveReference = (reference: string, chainName: string): string[] => {
  const path = reference.slice(REFERENCE_PREFIX.length).split(REFERENCE_SEPARATOR);
  path[0] ||= chainName;
  return path;
};

const serializeReference = (path: readonly string[]): string => {
  return REFERENCE_PREFIX + path.join(REFERENCE_SEPARATOR);
};

const resolveChainPlanSteps = (
  chainName: string,
  chainPlan: Plan,
  plan: Plan,
): Step[] => {
  const steps: Step[] = [];

  const evaluateReference = (reference: string): string | DeployPath => {
    let node: PlanElement = plan;
    const path = resolveReference(reference, chainName);
    for (const name of path) {
      if (node == null || typeof node !== 'object') {
        throw new Error(`Failed to resolve reference "${reference}" at "${name}"`);
      }

      node = Array.isArray(node)
        ? node[Number(name)]
        : node[name];
    }
  
    const name = path[path.length - 1];
    if (isContract(name)) {
      if (isContractAddress(node)) {
        return node;
      }
      return { path };
    }

    return evaluateValue(node);
  };

  const evaluateValue = (value: PlanElement): string | DeployPath => {
    if (typeof value === 'string') {
      if (isReference(value)) {
        return evaluateReference(value);
      }
      return value;
    }

    if (typeof value === 'boolean') {
      value = value ? 1 : 0;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return `${value}`;
    }

    if (Array.isArray(value)) {
      return `[${value.map(evaluateValue).join(',')}]`;
    }

    if (value != null) {
      return `{${Object.entries(value).map(([k, v]) => `${k}:${evaluateValue(v)}`).join(',')}}`;
    }

    throw new Error('Null values are not supported');
  };

  const evaluateNested = (node: Plan): Record<string, string | DeployPath> => {
    const nested: Record<string, string | DeployPath> = {};
    for (const [name, value] of Object.entries(node)) {
      nested[name] = evaluateValue(value);
    }
    return nested;
  };

  const visit = (node: PlanElement, path: readonly string[]): void => {
    if (node == null || typeof node !== 'object') {
      return;
    }

    for (const [name, value] of Object.entries(node)) {
      if (isContract(name)) {
        if (isContractAddress(value)) {
          continue;
        }

        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Invalid contract "${name}" value`);
        }

        const args = evaluateNested(value);
        const step: DeployStep = {
          type: 'deploy',
          name,
          path: [...path, name],
          args,
        };
        steps.push(step);
        continue;
      }

      if (isCall(name)) {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Invalid call "${name}" value`);
        }

        const { [CALL_TARGET]: target, ...args } = evaluateNested(value);
        if (target == null) {
          throw new Error(`Call "${name}" target is missing`);
        }

        const step: CallStep = {
          type: 'call',
          name: resolveCall(name),
          target,
          args,
        };
        steps.push(step);
        continue;
      }

      visit(value, [...path, name]);
    }
  };

  visit(chainPlan, [chainName]);

  return steps;
};

const resolveChainSteps = (
  plan: Plan,
  chainPlans: ReadonlyMap<string, Plan>,
): Map<string, Step[]> => {
  const chainSteps = new Map<string, Step[]>();
  for (const [chainName, chainPlan] of chainPlans) {
    const steps = resolveChainPlanSteps(chainName, chainPlan, plan);
    chainSteps.set(chainName, steps);
  }
  return chainSteps;
};

const collectChainDeploys = (
  deploys: Map<string, Deploy>,
  chainName: string,
  steps: readonly Step[],
  from: Address,
  nonce: number,
): void => {
  const totalDeploys = steps.reduce((c, s) => s.type === 'deploy' ? c + 1 : c, 0);
  console.log(`Deploys on ${chainName} (${totalDeploys}):`);

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.type !== 'deploy') {
      continue;
    }

    const reference = serializeReference(step.path);
    const existingDeploy = deploys.get(reference);
    if (existingDeploy != null) {
      throw new Error(`Deploy reference "${reference}" duplicate (#${existingDeploy.index} vs #${index})`);
    }

    const address = getCreateAddress({
      from,
      nonce: BigInt(nonce + index),
    });
    const deploy: Deploy = {
      index,
      address,
    };
    deploys.set(reference, deploy);

    console.log(`- deploy #${index}:`);
    console.log(`  - nonce: ${nonce + index}`);
    console.log(`  - address: ${address}`);
    console.log(`  - contract: ${step.name}`);
    console.log(`  - reference: ${reference}`);
  }
};

const resolveChainStepActions = (
  chainName: string,
  steps: readonly Step[],
  deploys: ReadonlyMap<string, Deploy>,
  nonce: number,
): Action[] => {
  const resolveField = (value: DeployPath | string): string => {
    if (typeof value !== 'object') {
      return value;
    }

    const reference = serializeReference(value.path);
    const deploy = deploys.get(reference);
    if (deploy != null) {
      return deploy.address;
    }

    throw new Error(`Failed to resolve deploy reference "${reference}"`);
  }

  const resolveRecord = (value: Record<string, DeployPath | string>): Record<string, string> => {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveField(v)]));
  };

  const encodeData = (args: Record<string, string>): Hex => {
    return `0xDATA ${JSON.stringify(args)}`; // TODO
  };

  const toDeployAction = (step: DeployStep, index: number): Action => {
    const action: Action = {
      nonce: nonce + index,
      data: encodeData(resolveRecord(step.args)),
    };

    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - data: ${action.data}`);
    return action;
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const target = resolveField(step.target);
    if (!isContractAddress(target)) {
      throw new Error(`Chain ${chainName} call action at #${index} has invalid target address "${target}"`);
    }

    const action: Action = {
      nonce: nonce + index,
      to: target,
      data: encodeData(resolveRecord(step.args)),
    };

    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - to: ${action.to}`);
    console.log(`  - data: ${action.data}`);
    return action;
  };

  const toAction = (step: Step, index: number): Action => {
    console.log(`- ${step.type} #${index}:`);
    switch (step.type) {
      case 'deploy':
        return toDeployAction(step, index);
      case 'call':
        return toCallAction(step, index);
      default:
        return step satisfies never;
    }
  };

  console.log(`Actions on ${chainName} (${steps.length}):`);
  const actions = steps.map(toAction);
  return actions;
};

const resolveChainActions = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
): Map<string, Action[]> => {
  console.log();
  const deploys = new Map<string, Deploy>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const from = clients.wallet.account.address;
    collectChainDeploys(deploys, chainName, steps, from, clients.nonce);
  }

  console.log();
  const chainActions = new Map<string, Action[]>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const actions = resolveChainStepActions(chainName, steps, deploys, clients.nonce);
    chainActions.set(chainName, actions);
  }
  return chainActions;
};

const executeSingleChainAction = async (
  chainName: string,
  action: Action,
  clients: ChainClients,
  actionIndex: number,
  totalActions: number,
): Promise<number> => {
  let retry = 0;
  while (true) {
    console.log(`Action #${actionIndex}/${totalActions} on ${chainName} started [${action.nonce}] ⏳`);
    if (retry > 0) {
      console.log(`This action execution is retry #${retry}, i.e. previous attempt has failed`);
    }

    try {
      const from = clients.wallet.account.address;
      const nonce = await clients.public.getTransactionCount({ address: from });

      if (nonce === action.nonce) {
        // TODO
        // await clients.wallet.sendTransaction({
        //   data: action.data,
        //   nonce: action.nonce,
        //   to: action.to,
        // });
      } else if (nonce > action.nonce) {
        console.warn(`On-chain nonce [${nonce}] is ahead of action #${actionIndex}/${totalActions} on ${chainName} nonce [${action.nonce}]`);
        console.warn('Assuming this action has been executed and thus will advance to next action');
        console.warn('Reminder: nonces must be preserved for deploy, interference cannot be detected by this tool - thus, may mess up deploy');
      } else { // nonce < action.nonce
        console.warn(`On-chain nonce [${nonce}] is behind of action #${actionIndex}/${totalActions} on ${chainName} nonce [${action.nonce}]`);
        console.warn('This might be due to slow on-chain state sync and will fix itself after some enforced retries');
        console.warn(`After ${NONCE_BEHIND_RETRIES} retries the issue assumed to be due to on-chain revert - thus, will retreat to previous action`);
        if (retry < NONCE_BEHIND_RETRIES) {
          throw new Error('On-chain nonce is behind action nonce');
        }

        console.log(`Action #${actionIndex}/${totalActions} on ${chainName} retreated [${action.nonce}] ⚠️`);
        return action.nonce - nonce; // Retreat
      }

      console.log(`Action #${actionIndex}/${totalActions} on ${chainName} finished [${action.nonce}] ✅`);
      return 1; // Advance
    } catch (e) {
      console.warn(`Action #${actionIndex}/${totalActions} on ${chainName} failed [${action.nonce}] ❌`);
      console.warn('Action error:', e);
      console.warn(`Action will be executed again as retry #${++retry} after ${RETRY_DELAY}ms delay`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY));
    }
  }
}

const executeSingleChainActions = async (
  chainName: string,
  actions: readonly Action[],
  clients: ChainClients,
): Promise<void> => {
  console.log(`Execution of ${actions.length} actions on ${chainName} started [${clients.nonce}] ⏳`);
  for (let index = 0; index < actions.length;) {
    const delta = await executeSingleChainAction(chainName, actions[index], clients, index, actions.length);
    index += delta;
    if (index < 0) {
      index = 0;
    }
  }
  console.log(`Execution of ${actions.length} actions on ${chainName} finished [${clients.nonce}] ✅`);
};

const executeChainActions = async (
  chainActions: ReadonlyMap<string, readonly Action[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
): Promise<void> => {
  console.log();
  console.log(`Executing actions for ${chainActions.size} chains:`);
  for (const chainName of chainActions.keys()) {
    const actions = chainActions.get(chainName)!;
    const clients = chainClients.get(chainName)!;
    console.log(`- ${chainName} has ${actions.length} actions to execute [${clients.nonce}]`);
  }

  const chainExecutions = chainActions.keys().map(async (chainName) => {
    const actions = chainActions.get(chainName)!;
    const clients = chainClients.get(chainName)!;
    await executeSingleChainActions(chainName, actions, clients);
  });
  await Promise.all(chainExecutions);
};

const main = async (): Promise<void> => {
  const args = parseArgs();

  const [plan, config] = await Promise.all([
    loadPlan(args.planPath),
    loadConfig(args.configPath),
  ]);

  const deployer = privateKeyToAccount(config.deployer.key);
  verifyPlanDeployer(deployer, plan);

  const chainPlans = extractChainPlans(plan);
  const chainClients = await resolveChainClients(deployer, chainPlans);
  const chainSteps = resolveChainSteps(plan, chainPlans);
  const chainActions = resolveChainActions(chainSteps, chainClients);

  await executeChainActions(chainActions, chainClients);
};

await main();
