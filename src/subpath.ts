import { isReference } from './parse';
import { resolveReference } from './resolve';
import { PlanNode } from './type';

export type SubpathGetter = () => readonly string[] | null;

export const makeSubpathGetter = (node: PlanNode, key: string, chainName: string): SubpathGetter => {
  return () => {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) {
      return null;
    }

    const subnode = node[key];
    if (typeof subnode !== 'string' || !isReference(subnode)) {
      return null;
    }

    return resolveReference(subnode, chainName);
  };
};
