import { Address, isAddressEqual, isHex } from 'viem';

import { loadYaml } from './file';
import { Plan } from './type';

export const loadPlan = async (path: string, deployer: Address): Promise<Plan> => {
  const plan = await loadYaml(path);

  let deployerMatch: boolean | undefined;
  if (plan.deployer != null) {
    if (!isHex(plan.deployer)) {
      throw new Error('Plan "deployer" must be a hex string');
    }
    deployerMatch = isAddressEqual(plan.deployer, deployer);
  }

  console.log();
  console.log('Plan:');
  console.log(
    '- deployer:' +
      (deployerMatch == null ? 'no specific one expected 👻' : `${plan.deployer} ${deployerMatch ? '✅' : '❌'}`),
  );

  if (deployerMatch === false) {
    throw new Error('Config deployer does not match deployer expected by plan');
  }

  return plan as Plan;
};
