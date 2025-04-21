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

export type PlanNode = string | number | boolean | null | PlanNode[] | { [key: string]: PlanNode };
export type Plan = { [key: string]: PlanNode };
export type PlanContext = {
  plan: Plan,
  chainName: string,
};

export type Artifact = {
  name: string,
  source: string,
  bytecode: Hex,
  constructor: AbiConstructor | undefined,
  functions: Map<string, AbiFunction>,
  resolutions: Map<string, Set<string>>,
}

export type ArtifactRegistry = {
  artifacts: Map<string, Artifact>,
  resolutions: Map<string, Set<string>>,
};

export type Deployer = PrivateKeyAccount;

export type ChainClients = {
  wallet: WalletClient<Transport, Chain, Deployer>,
  public: PublicClient,
  nonce: number,
};

export class DeployValue { public constructor(public readonly path: readonly string[]) {} }
export type ViemValue = boolean | number | bigint | string | ViemValue[] | { [key: string]: ViemValue };
export type Value = ViemValue | DeployValue | Value[] | { [key: string]: Value };

export type CallTarget = {
  name: string,
  address: string | DeployValue,
};

export type DeployStep = {
  type: 'deploy',
  name: string,
  path: readonly string[],
  args: Map<string, Value>,
  value: bigint | undefined,
  artifact: string | undefined,
};

export type CallStep = {
  type: 'call',
  name: string,
  target: CallTarget,
  args: Map<string, Value>,
  value: bigint | undefined,
  signature: string | undefined,
  artifact: string | undefined,
}

export type Step = DeployStep | CallStep;

export type Action = {
  nonce: number;
  to: Hex | undefined;
  data: Hex;
  value: bigint | undefined;
};

export type Lock = {
  nonces: Record<string, number>,
};
