import { CALL_ARTIFACT, CALL_SIGNATURE, CALL_TARGET, CALL_VALUE } from './constant';
import { evaluateNode } from './evaluate';
import { isAddress, isCall, isContract, isTransfer } from './parse';
import { createReference, resolveCall } from './resolve';
import {
  asArgsSpecial,
  asArtifactSpecial,
  asCallTargetSpecial,
  asSignatureSpecial,
  asTransferTargetSpecial,
  asValueSpecial,
} from './special';
import { makeSubpathGetter } from './subpath';
import { CallStep, DeployStep, Plan, PlanContext, PlanNode, Step, TransferStep } from './type';
import { mapPop } from './util';

const resolveChainPlanSteps = (chainName: string, chainPlan: Plan, plan: Plan): Step[] => {
  const ctx: PlanContext = {
    plan,
    chainName,
  };

  const steps: Step[] = [];

  const visitContract = (name: string, node: PlanNode, path: readonly string[]): void => {
    if (isAddress(node)) {
      return;
    }

    const args = asArgsSpecial(evaluateNode(ctx, node, path), path);
    const value = asValueSpecial(mapPop(args, CALL_VALUE), [...path, CALL_VALUE]);
    const artifact = asArtifactSpecial(mapPop(args, CALL_ARTIFACT), [...path, CALL_ARTIFACT]);

    const step: DeployStep = {
      type: 'deploy',
      name,
      path,
      args,
      value,
      artifact,
    };
    steps.push(step);
  };

  const visitCall = (name: string, node: PlanNode, path: readonly string[]): void => {
    const getSubpath = makeSubpathGetter(node, CALL_TARGET, chainName);

    const args = asArgsSpecial(evaluateNode(ctx, node, path), path);
    const target = asCallTargetSpecial(mapPop(args, CALL_TARGET), [...path, CALL_TARGET], getSubpath);
    const value = asValueSpecial(mapPop(args, CALL_VALUE), [...path, CALL_VALUE]);
    const signature = asSignatureSpecial(mapPop(args, CALL_SIGNATURE), [...path, CALL_SIGNATURE]);
    const artifact = asArtifactSpecial(mapPop(args, CALL_ARTIFACT), [...path, CALL_ARTIFACT]);

    const step: CallStep = {
      type: 'call',
      name,
      target,
      args,
      signature,
      value,
      artifact,
    };
    steps.push(step);
  };

  const visitTransfer = (node: PlanNode, path: readonly string[]): void => {
    const args = asArgsSpecial(evaluateNode(ctx, node, path), path);
    const target = asTransferTargetSpecial(mapPop(args, CALL_TARGET), [...path, CALL_TARGET]);
    const value = asValueSpecial(mapPop(args, CALL_VALUE), [...path, CALL_VALUE]);

    if (args.size > 0) {
      throw new Error(
        `Unused arguments detected at "${createReference(path)}": ` +
          `transfer only accepts target and value, but ${args.size} extra arguments provided`,
      );
    }

    const step: TransferStep = {
      type: 'transfer',
      target,
      value,
    };
    steps.push(step);
  };

  const visit = (node: PlanNode, path: readonly string[]): void => {
    if (node == null || typeof node !== 'object') {
      return;
    }

    for (const [name, subnode] of Object.entries(node)) {
      const subpath = [...path, name];

      if (isContract(name)) {
        visitContract(name, subnode, subpath);
        continue;
      }

      if (isCall(name)) {
        visitCall(resolveCall(name), subnode, subpath);
        continue;
      }

      if (isTransfer(name)) {
        visitTransfer(subnode, subpath);
        continue;
      }

      visit(subnode, subpath);
    }
  };

  visit(chainPlan, [chainName]);

  return steps;
};

export const resolveChainSteps = (plan: Plan, chainPlans: ReadonlyMap<string, Plan>): Map<string, Step[]> => {
  const chainSteps = new Map<string, Step[]>();
  for (const [chainName, chainPlan] of chainPlans) {
    const steps = resolveChainPlanSteps(chainName, chainPlan, plan);
    chainSteps.set(chainName, steps);
  }
  return chainSteps;
};
