import { CHAINS } from './chains';
import { CHAIN_ID_KEY } from './constant';
import { Plan } from './type';
import { joinComma } from './util';

export const extractChainPlans = (plan: Plan): Map<string, Plan> => {
  const chainIds: number[] = [];
  const chainNames: string[] = [];
  for (const [key, value] of Object.entries(plan)) {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || !(CHAIN_ID_KEY in value)) {
      continue;
    }

    const id = value[CHAIN_ID_KEY];
    if (typeof id !== 'number') {
      throw new Error(
        `Plan specifies "${key}" object with "${CHAIN_ID_KEY}" attribute of a chain, ` +
          'but the attribute has invalid type (number expected)',
      );
    }

    if (!CHAINS.has(id)) {
      throw new Error(
        `Plan specifies chain object "${key}" with "${CHAIN_ID_KEY}" set to "${id}", which is not supported`,
      );
    }

    chainIds.push(id);
    chainNames.push(key);
  }

  const chainEntries = chainNames.map((name, index) => `${name} (${chainIds[index]})`);
  console.log(`- chains (${chainNames.length}): ${joinComma(chainEntries)}`);

  const chainPlans = new Map<string, Plan>();
  for (const chainName of chainNames) {
    const chainPlan = plan[chainName];
    if (chainPlan == null || Array.isArray(chainPlan) || typeof chainPlan !== 'object') {
      throw new Error(`Invalid plan chain object named "${chainName}"`);
    }

    chainPlans.set(chainName, chainPlan);
  }
  return chainPlans;
};
