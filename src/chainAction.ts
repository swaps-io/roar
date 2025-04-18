import { Address, encodeDeployData, encodeFunctionData, getCreateAddress, toFunctionSelector, toFunctionSignature } from 'viem';

import { ChainClients, DeployStep, CallStep, Step, Deploy, Action, ArtifactRegistry } from './type';
import { createReference, resolveArguments, resolveArtifact, resolveFunction, resolveValue } from './resolve';
import { isContractAddress, } from './parse';
import { jsonStringify } from './util';

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

    const reference = createReference(step.path);
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
    console.log(`  - address: ${address} 🔮`);
    console.log(`  - contract: ${step.name}`);
    console.log(`  - reference: ${reference}`);
  }
};

const resolveChainStepActions = (
  chainName: string,
  steps: readonly Step[],
  deploys: ReadonlyMap<string, Deploy>,
  nonce: number,
  artifacts: ArtifactRegistry,
): Action[] => {
  const toDeployAction = (step: DeployStep, index: number): Action => {
    const artifact = resolveArtifact(step.name, step.artifact, artifacts, `Chain ${chainName} deploy action at #${index}`);
    const abi = artifact.constructor == null ? [] : [artifact.constructor];
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArguments(step.args, inputs, deploys, `"${step.name}" deploy`);

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

    console.log(`  - name: ${step.name}`);
    if (step.artifact) {
      console.log(`  - artifact: ${step.artifact}`);
    }
    console.log(`  - address: ${deploys.get(createReference(step.path))?.address} 🔮`);
    console.log(`  - arguments: ${jsonStringify(args)}`);
    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - data: ${action.data}`);
    if (action.value != null) {
      console.log(`  - value: ${action.value}`);
    }
    return action;
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const target = resolveValue(step.target.address, deploys);
    if (!isContractAddress(target)) {
      throw new Error(`Chain ${chainName} call action at #${index} has invalid target address "${target}"`);
    }

    const artifact = resolveArtifact(step.target.name, step.artifact, artifacts, `Chain ${chainName} call action at #${index}`);
    const func = resolveFunction(step.name, step.target.name, step.signature, artifact, `Chain ${chainName} call`);

    const abi = [func] as const;
    const inputs = abi.flatMap((a) => a.inputs);
    const args = resolveArguments(step.args, inputs, deploys, `"${step.target.name}.${step.name}" call`);

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

    console.log(`  - name: ${step.target.name}.${step.name}`);
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

  console.log(`Actions on ${chainName} (${steps.length}):`);
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
