import { Address, encodeDeployData, encodeFunctionData, getCreateAddress, toFunctionSelector, toFunctionSignature } from 'viem';

import { ChainClients, DeployStep, CallStep, Step, Deploy, Action, ArtifactRegistry } from './type';
import { createReference, resolveArguments, resolveArtifact, resolveFunction, resolveValue } from './resolve';
import { isContractAddress, } from './parse';
import { jsonStringify, yamlDump } from './util';

type ChainDeployerSpec = {
  address: Address,
  nonce: number,
};

type ChainContractSpec = {
  address: Address,
  name: string,
  artifact: string,
  source: string,
  reference: string,
  nonce: number,
  index: number,
};

type ChainDeploySpec = {
  id: number,
  name: string,
  deployer: ChainDeployerSpec,
  contracts: Record<Address, ChainContractSpec>,
};

type DeploySpec = Record<string, ChainDeploySpec>;

const collectChainDeploys = (
  deploys: Map<string, Deploy>,
  chainName: string,
  steps: readonly Step[],
  clients: ChainClients,
  artifacts: ArtifactRegistry,
): ChainDeploySpec => {
  const spec: ChainDeploySpec = {
    id: clients.public.chain.id,
    name: clients.public.chain.name,
    deployer: {
      address: clients.wallet.account.address,
      nonce: clients.nonce,
    },
    contracts: {},
  };

  const totalDeploys = steps.reduce((c, s) => s.type === 'deploy' ? c + 1 : c, 0);
  console.log(`Deploys on chain "${chainName}" (${totalDeploys}):`);

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.type !== 'deploy') {
      continue;
    }

    const reference = createReference(step.path);
    const existingDeploy = deploys.get(reference);
    if (existingDeploy != null) {
      throw new Error(`Deploy reference "${reference}" duplicate (#${index} vs #${existingDeploy.index})`);
    }

    const description = `Chain "${chainName}" deploy of "${step.name}" action at #${index}`;
    const artifact = resolveArtifact(step.name, step.artifact, artifacts, description);

    const nonce = spec.deployer.nonce + index;
    const address = getCreateAddress({
      from: spec.deployer.address,
      nonce: BigInt(nonce),
    });
    const deploy: Deploy = {
      index,
      address,
      description,
      artifact,
    };
    deploys.set(reference, deploy);

    const contract: ChainContractSpec = {
      address,
      name: step.name,
      reference,
      artifact: artifact.path,
      source: artifact.source,
      nonce,
      index,
    };
    spec.contracts[contract.address] = contract;

    console.log(`- deploy #${index}:`);
    console.log(`  - nonce: ${contract.nonce}`);
    console.log(`  - address: ${contract.address} 🔮`);
    console.log(`  - name: ${contract.name}`);
    console.log(`  - reference: ${contract.reference}`);
    console.log(`  - artifact: ${contract.artifact}`);
  }

  return spec;
};

const resolveChainStepActions = (
  chainName: string,
  steps: readonly Step[],
  deploys: ReadonlyMap<string, Deploy>,
  nonce: number,
  artifacts: ArtifactRegistry,
): Action[] => {
  const toDeployAction = (step: DeployStep, index: number): Action => {
    const reference = createReference(step.path);
    const deploy = deploys.get(reference)!;

    const abi = deploy.artifact.constructor == null ? [] : [deploy.artifact.constructor];
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArguments(step.args, inputs, deploys, deploy.description);

    const data = encodeDeployData({
      bytecode: deploy.artifact.bytecode,
      abi,
      args,
    });

    const action: Action = {
      nonce: nonce + index,
      to: undefined, // New contract
      data,
      value: step.value,
    };

    console.log(`  - name: ${step.name}`);
    console.log(`  - reference: ${reference}`);
    if (step.artifact) {
      console.log(`  - artifact: ${step.artifact}`);
    }
    console.log(`  - address: ${deploy.address} 🔮`);
    console.log(`  - arguments: ${jsonStringify(args)}`);
    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - data: ${action.data}`);
    if (action.value != null) {
      console.log(`  - value: ${action.value}`);
    }
    return action;
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const fullName = `${step.target.name}.${step.name}`;
    const description = `Chain "${chainName}" call of "${fullName}" action at #${index}`
    const target = resolveValue(step.target.address, deploys);
    if (!isContractAddress(target)) {
      throw new Error(`${description} has invalid target address "${target}"`);
    }

    const artifact = resolveArtifact(step.target.name, step.artifact, artifacts, description);
    const func = resolveFunction(step.name, step.target.name, step.signature, artifact, description);

    const abi = [func] as const;
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArguments(step.args, inputs, deploys, description);

    const data = encodeFunctionData({
      abi,
      args,
    });

    const action: Action = {
      nonce: nonce + index,
      to: target,
      data,
      value: step.value,
    };

    console.log(`  - name: ${fullName}`);
    if (step.signature) {
      console.log(`  - signature: ${step.signature}`);
    }
    if (step.artifact) {
      console.log(`  - artifact: ${step.artifact}`);
    }
    console.log(`  - function: ${toFunctionSignature(abi[0])} [${toFunctionSelector(abi[0])}]`);
    console.log(`  - arguments: ${jsonStringify(args)}`);
    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - to: ${action.to}`);
    console.log(`  - data: ${action.data}`);
    if (action.value != null) {
      console.log(`  - value: ${action.value}`);
    }
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

  console.log(`Actions on chain "${chainName}" (${steps.length}):`);
  const actions = steps.map(toAction);
  return actions;
};

export const resolveChainActions = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
  artifacts: ArtifactRegistry,
): Map<string, Action[]> => {
  console.log();
  const deploys = new Map<string, Deploy>();
  const deploySpec: DeploySpec = {};
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const spec = collectChainDeploys(deploys, chainName, steps, clients, artifacts);
    deploySpec[chainName] = spec;
  }

  console.log();
  console.log('Deploy spec:');
  console.log(yamlDump(deploySpec));

  console.log();
  const chainActions = new Map<string, Action[]>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const actions = resolveChainStepActions(chainName, steps, deploys, clients.nonce, artifacts);
    chainActions.set(chainName, actions);
  }
  return chainActions;
};
