import { CALL_TARGET, CALL_SIGNATURE, CALL_VALUE, REFERENCE_PREFIX, CALL_ARTIFACT } from './constant';
import { PlanElement, Plan, DeployStepArg, StepArg, DeployStep, CallStep, Step } from './type';
import { isCall, isContract, isContractAddress, isReference, resolveCall, resolveReference, serializeReference } from './parse';

const resolveChainPlanSteps = (
  chainName: string,
  chainPlan: Plan,
  plan: Plan,
): Step[] => {
  const steps: Step[] = [];

  const evaluateReference = (reference: string): StepArg => {
    let node: PlanElement = plan;
    let nodeName = REFERENCE_PREFIX;
    const path = resolveReference(reference, chainName);
    for (const name of path) {
      if (node == null || typeof node !== 'object') {
        throw new Error(`Failed to resolve reference "${reference}" at "${nodeName}"`);
      }

      node = Array.isArray(node)
        ? node[Number(name)]
        : node[name];
      nodeName = name;
    }
  
    const name = path[path.length - 1];
    if (isContract(name)) {
      if (isContractAddress(node)) {
        return node;
      }
      return new DeployStepArg(path);
    }

    return evaluateValue(node, path);
  };

  const evaluateValue = (value: PlanElement, path: readonly string[]): StepArg => {
    if (typeof value === 'string') {
      if (isReference(value)) {
        return evaluateReference(value);
      }
      return value;
    }

    if (typeof value === 'boolean') {
      value = value ? 1 : 0; // TODO: add Viem ABI encode tests for the evaluated strings
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return `${value}`;
    }

    if (Array.isArray(value)) {
      return value.map((value, index) => evaluateValue(value, [...path, `${index}`]));
    }

    if (value != null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, evaluateValue(v, [...path, k])]));
    }

    throw new Error(`Unexpected null value for "${serializeReference(path)}"`);
  };

  const evaluateNestedArgs = (node: Plan, path: readonly string[]): Map<string, StepArg> => {
    const nested = new Map<string, StepArg>();
    for (const [name, value] of Object.entries(node)) {
      nested.set(name, evaluateValue(value, [...path, name]));
    }
    return nested;
  };

  const evaluateCallValue = (
    value: PlanElement,
    path: readonly string[],
    description: string,
  ): bigint | undefined => {
    if (value == null) {
      return undefined;
    }

    const evaluated = evaluateValue(value, path);
    if (typeof evaluated !== 'string') {
      throw new Error(`${description} value must resolve to a primitive constant ("${serializeReference(path)}")`);
    }

    let callValue: bigint;
    try {
      callValue = BigInt(evaluated);
      if (callValue < 0n) {
        throw new Error();
      }
    } catch {
      throw new Error(`${description} value must be a non-negative integer number ("${serializeReference(path)}" has "${evaluated}")`);
    }

    return callValue > 0n ? callValue : undefined;
  };

  const evaluateCallArtifact = (
    value: PlanElement,
    path: readonly string[],
    description: string,
  ): string | undefined => {
    if (value == null) {
      return undefined;
    }

    const evaluated = evaluateValue(value, path);
    if (typeof evaluated !== 'string') {
      throw new Error(`${description} artifact must resolve to a string constant ("${serializeReference(path)}")`);
    }

    return evaluated;
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
          throw new Error(`Invalid contract "${name}" value ("${serializeReference(path)}")`);
        }

        const {
          [CALL_VALUE]: callValueValue,
          [CALL_ARTIFACT]: callArtifactValue,
          ...argsValue
        } = value;

        const deployPath = [...path, name];
        const args = evaluateNestedArgs(argsValue, deployPath);
        const deployValue = evaluateCallValue(callValueValue, [...deployPath, CALL_VALUE], `Deploy "${name}"`);
        const deployArtifact = evaluateCallArtifact(callArtifactValue, [...deployPath, CALL_ARTIFACT], `Deploy "${name}"`);
        const step: DeployStep = {
          type: 'deploy',
          name,
          path: deployPath,
          args,
          value: deployValue,
          artifact: deployArtifact,
        };
        steps.push(step);
        continue;
      }

      if (isCall(name)) {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Invalid call "${name}" value ("${serializeReference(path)}")`);
        }

        const {
          [CALL_TARGET]: targetValue,
          [CALL_SIGNATURE]: signatureValue,
          [CALL_VALUE]: callValueValue,
          [CALL_ARTIFACT]: callArtifactValue,
          ...argsValue
        } = value;

        const callName = resolveCall(name);
        const target = evaluateValue(targetValue, [...path, callName, CALL_TARGET]);
        if (target == null) {
          throw new Error(`Call "${name}" target is missing ("${serializeReference(path)}")`);
        }

        let targetName: string;
        if (target instanceof DeployStepArg) {
          targetName = target.path[target.path.length - 1];
        } else {
          if (typeof targetValue !== 'string' || !isReference(targetValue)) {
            throw new Error(`Call "${name}" target must be a contract reference ("${serializeReference(path)}")`);
          }

          const refPath = resolveReference(targetValue, chainName);
          targetName = refPath[refPath.length - 1];
          if (!isContract(targetName)) {
            throw new Error(`Call "${name}" target must be a contract reference ("${serializeReference(path)}")`);
          }
        }

        let signature: string | undefined;
        if (signatureValue != null) {
          if (typeof signatureValue !== 'string') {
            throw new Error(`Call "${name}" signature must be a constant or reference string ("${serializeReference(path)}")`);
          }

          if (isReference(signatureValue)) {
            const evaluated = evaluateReference(signatureValue);
            if (typeof evaluated !== 'string') {
              throw new Error(`Call "${name}" signature reference must resolve to a string constant ("${serializeReference(path)}")`);
            }
            signature = evaluated;
          } else {
            signature = signatureValue;
          }
        }

        const callPath = [...path, callName];
        const args = evaluateNestedArgs(argsValue, callPath);
        const callValue = evaluateCallValue(callValueValue, [...callPath, CALL_VALUE], `Call "${name}"`);
        const callArtifact = evaluateCallArtifact(callArtifactValue, [...callPath, CALL_ARTIFACT], `Call "${name}"`);
        const step: CallStep = {
          type: 'call',
          name: callName,
          targetName,
          target,
          args,
          signature,
          value: callValue,
          artifact: callArtifact,
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

export const resolveChainSteps = (
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
