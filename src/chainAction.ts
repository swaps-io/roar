import { Address, encodeDeployData, encodeFunctionData, getCreateAddress } from 'viem';
import { AbiFunction, AbiParameter } from 'abitype';

import { Artifact, ChainClients, DeployStepArg, StepArg, DeployStep, CallStep, Step, Deploy, Action } from './type';
import { isContractAddress, resolveInput, serializeReference } from './parse';

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
      to: undefined, // New contract
      data,
      value: step.value,
    };

    console.log(`  - name: ${step.name}`);
    console.log(`  - nonce: ${action.nonce}`);
    console.log(`  - data: ${action.data}`);
    if (action.value != null) {
      console.log(`  - value: ${action.value}`);
    }
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

    const trySignature = (signature: string): AbiFunction | null => {
      if (!signatures.has(signature)) {
        return null;
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
      value: step.value,
    };

    console.log(`  - name: ${step.targetName}.${step.name}`);
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
