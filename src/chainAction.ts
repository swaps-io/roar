import { Address, encodeDeployData, encodeFunctionData, getCreateAddress, toFunctionSelector, toFunctionSignature } from 'viem';

import { ChainClients, DeployStep, CallStep, Step, Action, ArtifactRegistry } from './type';
import { createReference, resolveArguments, resolveArtifact, resolveFunction, resolveValue } from './resolve';
import { isContractAddress, } from './parse';
import { jsonStringify } from './util';

const resolveStepDeploys = (
  steps: readonly Step[],
  from: Address,
  nonce: number,
  deploys: Map<string, string>,
): void => {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.type !== 'deploy') {
      continue;
    }

    const reference = createReference(step.path);
    if (deploys.has(reference)) {
      throw new Error(`Deploy reference "${reference}" duplicate at #${index}`);
    }

    const address = getCreateAddress({
      from,
      nonce: BigInt(nonce + index),
    });
    deploys.set(reference, address);
  }
};

const resolveDeploys = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
): Map<string, string> => {
  const deploys = new Map<string, string>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const from = clients.wallet.account.address;
    resolveStepDeploys(steps, from, clients.nonce, deploys);
  }
  return deploys;
};

const resolveStepActions = (
  chainName: string,
  steps: readonly Step[],
  deploys: ReadonlyMap<string, string>,
  nonce: number,
  artifacts: ArtifactRegistry,
): Action[] => {
  const toDeployAction = (step: DeployStep, index: number): Action => {
    const reference = createReference(step.path);
    const description = `Chain "${chainName}" deploy of "${step.name}" action at #${index}`;
    const artifact = resolveArtifact(step.name, step.artifact, artifacts, description);
    const abi = artifact.constructor == null ? [] : [artifact.constructor];
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArguments(step.args, inputs, deploys, description);

    const data = encodeDeployData({
      bytecode: artifact.bytecode,
      abi,
      args,
    });

    const action: Action = {
      nonce: nonce + index,
      to: undefined, // New contract
      data,
      value: step.value,
    };

    console.log(`  - resolution:`);
    console.log(`    - name: ${step.name}`);
    console.log(`    - reference: ${reference}`);
    console.log(`    - artifact: ${artifact.path}`);
    console.log(`    - arguments: ${jsonStringify(args)}`);
    console.log(`    - address: ${deploys.get(reference)} 🔮`);

    console.log(`  - transaction:`);
    console.log(`    - nonce: ${action.nonce}`);
    if (action.value != null) {
      console.log(`    - value: ${action.value}`);
    }
    console.log(`    - data: ${action.data}`);

    return action;
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const fullName = `${step.target.name}.${step.name}`;
    const description = `Chain "${chainName}" call of "${fullName}" action at #${index}`
    const target = resolveValue(step.target.address, deploys);
    if (!isContractAddress(target)) {
      throw new Error(`${description} has invalid target contract address (${jsonStringify(target)})`);
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

    console.log(`  - resolution:`);
    console.log(`    - name: ${fullName}`);
    console.log(`    - artifact: ${artifact.path}`);
    console.log(`    - function: ${toFunctionSignature(abi[0])} [${toFunctionSelector(abi[0])}]`);
    console.log(`    - arguments: ${jsonStringify(args)}`);

    console.log(`  - transaction:`);
    console.log(`    - nonce: ${action.nonce}`);
    console.log(`    - to: ${action.to}`);
    if (action.value != null) {
      console.log(`    - value: ${action.value}`);
    }
    console.log(`    - data: ${action.data}`);

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

const resolveActions = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
  artifacts: ArtifactRegistry,
  deploys: ReadonlyMap<string, string>,
): Map<string, Action[]> => {
  console.log();
  const chainActions = new Map<string, Action[]>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const actions = resolveStepActions(chainName, steps, deploys, clients.nonce, artifacts);
    chainActions.set(chainName, actions);
  }
  return chainActions;
}

export const resolveChainActions = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
  artifacts: ArtifactRegistry,
): Map<string, Action[]> => {
  const deploys = resolveDeploys(chainSteps, chainClients);
  const chainActions = resolveActions(chainSteps, chainClients, artifacts, deploys);
  return chainActions;
};
