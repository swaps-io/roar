import { Address, getCreateAddress } from 'viem';

import { encodeCall } from './encodeCall';
import { encodeDeploy } from './encodeDeploy';
import { isAddress } from './parse';
import { createReference, resolveValue } from './resolve';
import {
  Action,
  ActionTransaction,
  ArtifactRegistry,
  CallActionResolution,
  CallStep,
  ChainClients,
  DeployActionResolution,
  DeployRegistry,
  DeployStep,
  Step,
  TransferActionResolution,
  TransferStep,
} from './type';
import { jsonStringify } from './util';

const resolveStepDeploys = (steps: readonly Step[], from: Address, nonce: number, deploys: DeployRegistry): void => {
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
): DeployRegistry => {
  const deploys: DeployRegistry = new Map();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const from = clients.wallet.account.address;
    resolveStepDeploys(steps, from, clients.nonce, deploys);
  }
  return deploys;
};

const logDeployResolution = (resolution: DeployActionResolution): void => {
  console.log(`  - resolution:`);
  console.log(`    - name: ${resolution.name}`);
  console.log(`    - reference: ${resolution.reference}`);
  console.log(`    - artifact: ${resolution.artifact}`);
  console.log(`    - arguments: ${resolution.arguments}`);
  console.log(`    - address: ${resolution.address} 🔮`);
};

const logCallResolution = (resolution: CallActionResolution): void => {
  console.log(`  - resolution:`);
  console.log(`    - name: ${resolution.name}`);
  console.log(`    - artifact: ${resolution.artifact}`);
  console.log(`    - function: ${resolution.function} [${resolution.selector}]`);
  console.log(`    - arguments: ${resolution.arguments}`);
};

const logTransaction = (transaction: ActionTransaction): void => {
  console.log(`  - transaction:`);
  console.log(`    - nonce: ${transaction.nonce}`);
  if (transaction.to != null) {
    console.log(`    - to: ${transaction.to}`);
  }
  if (transaction.value != null) {
    console.log(`    - value: ${transaction.value}`);
  }
  if (transaction.data != null) {
    console.log(`    - data: ${transaction.data}`);
  }
};

const resolveStepActions = (
  chainName: string,
  steps: readonly Step[],
  deploys: DeployRegistry,
  nonce: number,
  artifacts: ArtifactRegistry,
): Action[] => {
  const toDeployAction = (step: DeployStep, index: number): Action => {
    const reference = createReference(step.path);
    const description = `Chain "${chainName}" deploy of "${step.name}" action at #${index}`;

    const { data, args, artifact } = encodeDeploy({
      name: step.name,
      args: step.args,
      artifact: step.artifact,
      deploys,
      artifacts,
      description,
    });

    const resolution: DeployActionResolution = {
      type: 'deploy',
      name: step.name,
      reference,
      artifact,
      arguments: jsonStringify(args),
      address: deploys.get(reference)!,
    };
    logDeployResolution(resolution);

    const transaction: ActionTransaction = {
      nonce: nonce + index,
      to: undefined, // New contract
      data,
      value: step.value,
    };
    logTransaction(transaction);

    const action: Action = {
      resolution,
      transaction,
    };
    return action;
  };

  const toCallAction = (step: CallStep, index: number): Action => {
    const fullName = `${step.target.name}.${step.name}`;
    const description = `Chain "${chainName}" call of "${fullName}" action at #${index}`;
    const target = resolveValue({ value: step.target.address, deploys, artifacts, description });
    if (!isAddress(target)) {
      throw new Error(`${description} has invalid target contract address (${jsonStringify(target)})`);
    }

    const { data, args, artifact, signature, selector } = encodeCall({
      name: step.name,
      targetName: step.target.name,
      args: step.args,
      signature: step.signature,
      artifact: step.artifact,
      deploys,
      artifacts,
      description,
    });

    const resolution: CallActionResolution = {
      type: 'call',
      name: fullName,
      artifact,
      function: signature,
      selector,
      arguments: jsonStringify(args),
    };
    logCallResolution(resolution);

    const transaction: ActionTransaction = {
      nonce: nonce + index,
      to: target,
      data,
      value: step.value,
    };
    logTransaction(transaction);

    const action: Action = {
      resolution,
      transaction,
    };
    return action;
  };

  const toTransferAction = (step: TransferStep, index: number): Action => {
    const description = `Chain "${chainName}" transfer action at #${index}`;
    const target = resolveValue({ value: step.target.address, deploys, artifacts, description });
    if (!isAddress(target)) {
      throw new Error(`${description} has invalid target address (${jsonStringify(target)})`);
    }

    const resolution: TransferActionResolution = {
      type: 'transfer',
    };

    const transaction: ActionTransaction = {
      nonce: nonce + index,
      to: target,
      data: undefined,
      value: step.value,
    };
    logTransaction(transaction);

    const action: Action = {
      resolution,
      transaction,
    };
    return action;
  };

  const toAction = (step: Step, index: number): Action => {
    console.log(`- ${step.type} #${index}:`);
    switch (step.type) {
      case 'deploy':
        return toDeployAction(step, index);
      case 'call':
        return toCallAction(step, index);
      case 'transfer':
        return toTransferAction(step, index);
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
  deploys: DeployRegistry,
): Map<string, Action[]> => {
  console.log();
  const chainActions = new Map<string, Action[]>();
  for (const [chainName, steps] of chainSteps) {
    const clients = chainClients.get(chainName)!;
    const actions = resolveStepActions(chainName, steps, deploys, clients.nonce, artifacts);
    chainActions.set(chainName, actions);
  }
  return chainActions;
};

export const resolveChainActions = (
  chainSteps: ReadonlyMap<string, readonly Step[]>,
  chainClients: ReadonlyMap<string, ChainClients>,
  artifacts: ArtifactRegistry,
): Map<string, Action[]> => {
  const deploys = resolveDeploys(chainSteps, chainClients);
  const chainActions = resolveActions(chainSteps, chainClients, artifacts, deploys);
  return chainActions;
};
