import { AbiConstructor, AbiFunction } from 'abitype';
import { Chain, Hex, PrivateKeyAccount, PublicClient, Transport, WalletClient } from 'viem';

export type Args = {
  planPath: string;
  configPath: string;
  artifactsPath: string;
  locksPath: string;
  specPath: string;
};

export type ConfigDeployer = {
  privateKey: Hex;
};

export type ConfigExecution = {
  dryRun: boolean;
  retryDelay: number;
  nonceBehindRetries: number;
};

export type Config = {
  deployer: ConfigDeployer;
  execution: ConfigExecution;
};

export type PlanNode = string | number | boolean | null | PlanNode[] | { [key: string]: PlanNode };
export type Plan = { [key: string]: PlanNode };
export type PlanContext = {
  plan: Plan;
  chainName: string;
};

export type Artifact = {
  path: string;
  name: string;
  source: string;
  bytecode: Hex;
  constructor: AbiConstructor | undefined;
  functions: Map<string, AbiFunction>;
  resolutions: Map<string, Set<string>>;
};

export type ArtifactRegistry = {
  artifacts: Map<string, Artifact>;
  resolutions: Map<string, Set<string>>;
};

export type DeployRegistry = Map<string, string>;

export type Deployer = PrivateKeyAccount;

export type ChainClients = {
  wallet: WalletClient<Transport, Chain, Deployer>;
  public: PublicClient<Transport, Chain>;
  nonce: number;
};

export class DeployValue {
  public constructor(public readonly path: readonly string[]) {}
}

export class DeployEncodeValue {
  public constructor(
    public readonly target: EncodeTarget,
    public readonly args: Map<string, Value>,
    public readonly artifact: string | undefined,
  ) {}
}

export class CallEncodeValue {
  public constructor(
    public readonly target: EncodeTarget,
    public readonly args: Map<string, Value>,
    public readonly signature: string | undefined,
    public readonly artifact: string | undefined,
  ) {}
}

export type ViemValue = boolean | number | bigint | string | ViemValue[] | { [key: string]: ViemValue };
export type Value = ViemValue | DeployValue | DeployEncodeValue | CallEncodeValue | Value[] | { [key: string]: Value };

export type CallTarget = {
  name: string;
  address: string | DeployValue;
};

export type TransferTarget = {
  address: string | DeployValue;
};

export type EncodeTarget = {
  name: string;
};

export type DeployStep = {
  type: 'deploy';
  name: string;
  path: readonly string[];
  args: Map<string, Value>;
  value: bigint | undefined;
  artifact: string | undefined;
};

export type CallStep = {
  type: 'call';
  name: string;
  target: CallTarget;
  args: Map<string, Value>;
  value: bigint | undefined;
  signature: string | undefined;
  artifact: string | undefined;
};

export type TransferStep = {
  type: 'transfer';
  target: TransferTarget;
  value: bigint | undefined;
};

export type Step = DeployStep | CallStep | TransferStep;

export type DeployActionResolution = {
  type: 'deploy';
  name: string;
  reference: string;
  artifact: string;
  arguments: string;
  address: string;
};

export type CallActionResolution = {
  type: 'call';
  name: string;
  artifact: string;
  function: string;
  selector: string;
  arguments: string;
};

export type TransferActionResolution = {
  type: 'transfer';
};

export type ActionResolution = DeployActionResolution | CallActionResolution | TransferActionResolution;

export type ActionTransaction = {
  nonce: number;
  to: Hex | undefined;
  data: Hex | undefined;
  value: bigint | undefined;
};

export type Action = {
  resolution: ActionResolution;
  transaction: ActionTransaction;
};

export type ArgsSpec = {
  plan: string;
  config: string;
  artifacts: string;
  locks: string;
  spec: string;
};

export type DeployerSpec = {
  address: string;
};

export type ChainSpec = {
  id: number;
  key: string;
  name: string;
  rpcs: readonly string[];
};

export interface ChainDeployerSpec {
  address: string;
  nonce: number;
}

export type ChainActionsSpec = {
  chain: ChainSpec;
  deployer: ChainDeployerSpec;
  actions: Action[];
};

export type PlanSpec = {
  args: ArgsSpec;
  deployer: DeployerSpec;
  chains: Record<string, ChainActionsSpec>;
};

export type Lock = {
  nonces: Record<string, number>;
};
