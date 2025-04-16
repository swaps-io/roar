import { Chain, Hex, PublicClient, Transport, WalletClient, PrivateKeyAccount } from 'viem';
import { AbiConstructor, AbiFunction } from 'abitype';

export type Args = {
  planPath: string,
  configPath: string,
  artifactsPath: string,
  locksPath: string,
};

export type ConfigDeployer = {
  privateKey: Hex,
};

export type ConfigExecution = {
  dryRun: boolean;
  retryDelay: number,
  nonceBehindRetries: number,
};

export type Config = {
  deployer: ConfigDeployer,
  execution: ConfigExecution,
};

export type PlanElement = string | number | boolean | null | PlanElement[] | { [key: string]: PlanElement };
export type Plan = { [key: string]: PlanElement };

export type Artifact = {
  name: string,
  source: string,
  bytecode: Hex,
  constructor: AbiConstructor | undefined,
  functions: Map<string, AbiFunction>,
  resolutions: Map<string, Set<string>>,
}

export type Deployer = PrivateKeyAccount;

export type ChainClients = {
  wallet: WalletClient<Transport, Chain, Deployer>,
  public: PublicClient,
  nonce: number,
};

export class DeployStepArg { public constructor(public readonly path: readonly string[]) {} }
export type StepArg = string | StepArg[] | DeployStepArg | { [key: string]: StepArg };

export type DeployStep = {
  type: 'deploy',
  name: string,
  path: string[],
  args: Map<string, StepArg>,
};

export type CallStep = {
  type: 'call',
  name: string,
  targetName: string,
  target: StepArg,
  args: Map<string, StepArg>,
  signature: string | undefined;
}

export type Step = DeployStep | CallStep;

export type Deploy = {
  index: number,
  address: string,
};

export type Action = {
  nonce: number;
  to?: Hex;
  data: Hex;
};

export type Lock = {
  nonces: Record<string, number>,
};
