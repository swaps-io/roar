import fs from 'fs/promises';
import ps from 'path';
import yaml from 'js-yaml';

import {
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  getCreateAddress,
  Hex,
  http,
  isAddressEqual,
  isHex,
  PrivateKeyAccount,
  PublicClient,
  toFunctionSignature,
  Transport,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base, gnosis } from 'viem/chains';
import { AbiConstructor, AbiFunction, AbiParameter } from 'abitype';

const CHAINS = new Map<string, Chain>([
  ['gnosis', gnosis],
  ['base', base],
  ['arbitrum', arbitrum],
]);

const DEFAULT_PLAN_PATH = 'plan.yaml';
const DEFAULT_CONFIG_PATH = 'config.yaml';
const DEFAULT_ARTIFACTS_PATH = 'artifacts';

const CALL_PREFIX = '$';
const CALL_TARGET = '$';
const CALL_SIGNATURE = '$sig';

const REFERENCE_PREFIX = '$';
const REFERENCE_SEPARATOR = '.';

const INPUT_PREFIXES = ['_'];
const INPUT_SUFFIXES = ['_'];

const RETRY_DELAY = 8_000; // 8s
const NONCE_BEHIND_RETRIES = 15; // * 8s = 2m

type Args = {
  planPath: string,
  configPath: string,
  artifactsPath: string,
};

type ConfigDeployer = {
  key: Hex,
};

type Config = {
  deployer: ConfigDeployer,
};

type PlanElement = string | number | boolean | null | PlanElement[] | { [key: string]: PlanElement };
type Plan = { [key: string]: PlanElement };

type Artifact = {
  name: string,
  source: string,
  bytecode: Hex,
  constructor: AbiConstructor | undefined,
  functions: Map<string, AbiFunction>,
  resolutions: Map<string, Set<string>>,
}

type ChainClients = {
  wallet: WalletClient<Transport, Chain, PrivateKeyAccount>,
  public: PublicClient,
  nonce: number,
};

class DeployStepArg { public constructor(public readonly path: readonly string[]) {} }
type StepArg = string | StepArg[] | DeployStepArg | { [key: string]: StepArg };

type DeployStep = {
  type: 'deploy',
  name: string,
  path: string[],
  args: Map<string, StepArg>,
};

type CallStep = {
  type: 'call',
  name: string,
  targetName: string,
  target: StepArg,
  args: Map<string, StepArg>,
  signature: string | undefined;
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
    throw new Error(`Usage: roar [--plan <plan-path>] [--config <config-path>] [--artifacts <artifacts-path>]`);
  };

  const args: Args = {
    configPath: DEFAULT_CONFIG_PATH,
    planPath: DEFAULT_PLAN_PATH,
    artifactsPath: DEFAULT_ARTIFACTS_PATH,
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

      case '--artifacts':
      case '-a':
        args.artifactsPath = getArgValue(index + 1);
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
  console.log(`Artifacts path: ${args.artifactsPath}`);
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

const loadJson = async (path: string): Promise<any> => {
  const text = await loadText(path);
  const object = JSON.parse(text);
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

const discoverArtifactPaths = async (path: string): Promise<Map<string, string>> => {
  const entries = await fs.readdir(path, { recursive: true, withFileTypes: true });
  const artifactPaths = new Map<string, string>();
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.parentPath.endsWith('.sol') &&
      entry.name.endsWith('.json')
    ) {
      const artifactName = entry.name.slice(0, -'.json'.length);
      const artifactPath = ps.join(entry.parentPath, entry.name);
      const existingPath = artifactPaths.get(artifactName);
      if (existingPath != null) {
        throw new Error(`Artifact "${artifactName}" path duplicate ("${artifactPath}" vs "${existingPath}")`);
      }
      artifactPaths.set(artifactName, artifactPath);
    }
  }
  return artifactPaths;
};

const loadArtifact = async (name: string, path: string): Promise<Artifact> => {
  const content = await loadJson(path);
  if (content.contractName !== name) {
    throw new Error(`Artifact at "${path}" has mismatching "contractName" value ("${name}" expected)`);
  }

  if (typeof content.sourceName !== 'string') {
    throw new Error(`Artifact at "${path}" has unexpected "sourceName" value type (string expected)`);
  }

  if (!isHex(content.bytecode)) {
    throw new Error(`Artifact at "${path}" has unexpected "bytecode" value type (hex string expected)`);
  }

  if (!Array.isArray(content.abi)) {
    throw new Error(`Artifact at "${path}" has unexpected "abi" value type (array expected)`);
  }

  let constructor: AbiConstructor | undefined;
  const functions = new Map<string, AbiFunction>();
  const resolutions = new Map<string, Set<string>>();
  for (const abi of content.abi) {
    switch (abi.type) {
      case 'constructor':
        constructor = abi;
        break;

      case 'function':
        const signature = toFunctionSignature(abi);

        const sizeBefore = functions.size;
        functions.set(signature, abi);
        if (functions.size === sizeBefore) {
          throw new Error(`Artifact at "${path}" has function "${signature}" duplicate in "abi"`);
        }

        const signatures = resolutions.get(abi.name);
        if (signatures == null) {
          resolutions.set(abi.name, new Set([signature]));
        } else {
          signatures.add(signature);
        }
        break;
    }
  }

  const artifact: Artifact = {
    name,
    source: content.sourceName,
    bytecode: content.bytecode,
    constructor,
    functions,
    resolutions,
  };
  return artifact;
}

const loadArtifacts = async (path: string): Promise<Map<string, Artifact>> => {
  const artifactPaths = await discoverArtifactPaths(path);
  const artifacts = new Map<string, Artifact>();
  await Promise.all(artifactPaths.entries().map(async ([name, path]) => {
    const artifact = await loadArtifact(name, path);
    artifacts.set(name, artifact);
  }));
  return artifacts;
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

const resolveInput = (name: string): string => {
  let keepResolving = true;
  while (keepResolving) {
    keepResolving = false;
    for (const prefix of INPUT_PREFIXES) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        keepResolving = true;
      }
    }
    for (const suffix of INPUT_SUFFIXES) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        keepResolving = true;
      }
    }
  }
  return name;
};

const resolveChainPlanSteps = (
  chainName: string,
  chainPlan: Plan,
  plan: Plan,
): Step[] => {
  const steps: Step[] = [];

  const evaluateReference = (reference: string): StepArg => {
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
      return new DeployStepArg(path);
    }

    return evaluateValue(node);
  };

  const evaluateValue = (value: PlanElement): StepArg => {
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
      return value.map(evaluateValue);
    }

    if (value != null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, evaluateValue(v)]));
    }

    throw new Error('Null values are not supported');
  };

  const evaluateNested = (node: Plan): Map<string, StepArg> => {
    const nested = new Map<string, StepArg>();
    for (const [name, value] of Object.entries(node)) {
      nested.set(name, evaluateValue(value));
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

        const { [CALL_TARGET]: targetValue, [CALL_SIGNATURE]: signatureValue, ...argsValue } = value;

        const target = evaluateValue(targetValue);
        if (target == null) {
          throw new Error(`Call "${name}" target is missing`);
        }

        let targetName: string;
        if (target instanceof DeployStepArg) {
          targetName = target.path[target.path.length - 1];
        } else {
          if (typeof targetValue !== 'string' || !isReference(targetValue)) {
            throw new Error(`Call "${name}" target must be a contract reference`);
          }

          const path = resolveReference(targetValue, chainName);
          targetName = path[path.length - 1];
          if (!isContract(targetName)) {
            throw new Error(`Call "${name}" target must be a contract reference`);
          }
        }

        let signature: string | undefined;
        if (signatureValue != null) {
          if (typeof signatureValue !== 'string') {
            throw new Error(`Call "${name}" signature must be a constant or reference string`);
          }

          if (isReference(signatureValue)) {
            const evaluated = evaluateReference(signatureValue);
            if (typeof evaluated !== 'string') {
              throw new Error(`Call "${name}" signature reference must resolve to a string constant`);
            }
            signature = evaluated;
          } else {
            signature = signatureValue;
          }
        }

        const args = evaluateNested(argsValue);
        const step: CallStep = {
          type: 'call',
          name: resolveCall(name),
          targetName,
          target,
          args,
          signature,
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
      throw new Error(`Deploy reference "${reference}" duplicate (#${index} vs #${existingDeploy.index})`);
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
  artifacts: ReadonlyMap<string, Artifact>,
): Action[] => {
  type Param = string | Param[] | { [key: string]: Param };

  const resolveParam = (value: StepArg): Param => {
    if (value instanceof DeployStepArg) {
      const reference = serializeReference(value.path);
      const deploy = deploys.get(reference);
      if (deploy != null) {
        return deploy.address;
      }
      throw new Error(`Failed to resolve deploy reference "${reference}"`);
    }

    if (Array.isArray(value)) {
      return value.map(resolveParam);
    }

    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveParam(v)]));
    }

    return value;
  }

  const resolveArgs = (
    args: ReadonlyMap<string, StepArg>,
    inputs: readonly AbiParameter[],
    description: string,
  ): Param[] => {
    const params: Param[] = [];
    for (const input of inputs) {
      if (!input.name) {
        throw new Error(`ABI input for ${description} has "name" missing`);
      }

      const name = resolveInput(input.name);
      const arg = args.get(name);
      if (arg == null) {
        throw new Error(`Argument "${name}" was not provided for ${description}`);
      }

      const param = resolveParam(arg);
      params.push(param);
    }
    return params;
  };

  const toDeployAction = (step: DeployStep, index: number): Action => {
    const artifact = artifacts.get(step.name);
    if (artifact == null) {
      throw new Error(`Chain ${chainName} call action at #${index} missing artifact for "${step.name}" deploy`);
    }

    const abi = artifact.constructor == null ? [] : [artifact.constructor];
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArgs(step.args, inputs, `"${step.name}" deploy`);

    const data = encodeDeployData({
      bytecode: artifact.bytecode,
      abi,
      args,
    });

    const action: Action = {
      nonce: nonce + index,
      data,
    };

    console.log(`  - name: ${step.name}`);
    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - data: ${action.data}`);
    return action;
  };

  const resolveCallFunction = (step: CallStep, artifact: Artifact): AbiFunction => {
    const func = artifact.functions.get(step.name);
    if (func != null) {
      return func;
    }

    const signatures = artifact.resolutions.get(step.name);
    if (signatures == null) {
      throw new Error(`Chain ${chainName} call targets function "${step.name}" missing in artifact "${step.targetName}"`);
    }

    if (signatures.size === 1) {
      const signature = [...signatures][0];
      const func = artifact.functions.get(signature)!;
      return func;
    }

    if (!step.signature) {
      throw new Error(
        `Chain ${chainName} call to function "${step.name}" of artifact "${step.targetName}" must specify ` +
        `signature field to resolve ambiguity among ${signatures.size} overload candidates`
      );
    }

    const trySignature = (signature: string): AbiFunction | undefined => {
      if (!signatures.has(signature)) {
        return undefined;
      }

      const func = artifact.functions.get(signature)!;
      return func;
    };

    const badSignature = (): never => {
      throw new Error(
        `Chain ${chainName} call to function "${step.name}" of artifact "${step.targetName}" specifies signature ` +
        `"${step.signature}" that could not be matched with any of ${signatures.size} overload candidates`
      );
    };

    return (
      trySignature(step.signature) ??
      trySignature(step.name + step.signature) ??
      trySignature(`${step.name}(${step.signature})`) ??
      badSignature()
    );
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const target = resolveParam(step.target);
    if (!isContractAddress(target)) {
      console.log(target);
      throw new Error(`Chain ${chainName} call action at #${index} has invalid target address "${target}"`);
    }

    const artifact = artifacts.get(step.targetName);
    if (artifact == null) {
      throw new Error(`Chain ${chainName} call action at #${index} missing artifact for "${step.targetName}" call target`);
    }

    const func = resolveCallFunction(step, artifact);

    const abi = [func] as const;
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArgs(step.args, inputs, `"${step.targetName}.${step.name}" call`);

    const data = encodeFunctionData({
      abi,
      args,
    });

    const action: Action = {
      nonce: nonce + index,
      to: target,
      data,
    };

    console.log(`  - name: ${step.targetName}.${step.name}`);
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
  artifacts: ReadonlyMap<string, Artifact>,
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
    const actions = resolveChainStepActions(chainName, steps, deploys, clients.nonce, artifacts);
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

  const artifacts = await loadArtifacts(args.artifactsPath);
  const chainPlans = extractChainPlans(plan);
  const chainClients = await resolveChainClients(deployer, chainPlans);
  const chainSteps = resolveChainSteps(plan, chainPlans);
  const chainActions = resolveChainActions(chainSteps, chainClients, artifacts);

  await executeChainActions(chainActions, chainClients);
};

await main();
