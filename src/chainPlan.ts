import { Plan } from './type';
import { CHAINS } from './chains';

export const extractChainPlans = (plan: Plan): Map<string, Plan> => {
  const chainNames = Object.keys(plan).filter((key) => CHAINS.has(key));
  console.log(`- chains (${chainNames.length}): ${chainNames.join(', ')}`);

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
