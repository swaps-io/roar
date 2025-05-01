import { DeployValue, PlanContext, PlanNode, Value } from './type';
import { isContract, isAddress, isReference } from './parse';
import { createReference, resolveReference } from './resolve';
import { REFERENCE_PREFIX } from './constant';

const evaluateReference = (
  ctx: PlanContext,
  reference: string,
): Value => {
  let node: PlanNode = ctx.plan;
  let nodeName = REFERENCE_PREFIX;
  const path = resolveReference(reference, ctx.chainName);
  for (const name of path) {
    if (node == null || typeof node !== 'object') {
      throw new Error(`Failed to resolve "${nodeName}" node of "${reference}" reference`);
    }

    node = Array.isArray(node)
      ? node[Number(name)]
      : node[name];
    nodeName = name;
  }

  const name = path[path.length - 1];
  if (isContract(name)) {
    if (isAddress(node)) {
      return node;
    }

    return new DeployValue(path);
  }

  return evaluateNode(ctx, node, path);
};

export const evaluateNode = (
  ctx: PlanContext,
  node: PlanNode,
  path: readonly string[],
): Value => {
  const value = evaluateNodeNull(ctx, node, path);
  if (value == null) {
    throw new Error(`Unexpected null value at "${createReference(path)}"`);
  }

  return value;
}

const evaluateNodeNull = (
  ctx: PlanContext,
  node: PlanNode,
  path: readonly string[],
): Value | null => {
  if (node == null) {
    return null;
  }

  if (typeof node === 'string') {
    if (isReference(node)) {
      return evaluateReference(ctx, node);
    }
    return node;
  }

  if (
    typeof node === 'number' ||
    typeof node === 'bigint' ||
    typeof node === 'boolean'
  ) {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(
      (subnode, index) => evaluateNodeNull(ctx, subnode, [...path, `${index}`]),
    ).filter(
      (value) => value != null,
    );
  }

  return Object.fromEntries(
    Object.entries(node).map(
      ([name, subnode]) => [name, evaluateNodeNull(ctx, subnode, [...path, name])],
    ).filter(
      ([name, value]) => value != null,
    ),
  );
};
