import { Address, isAddressEqual, isHex } from 'viem';

import { DEPLOYER_KEY } from './constant';
import { loadYaml } from './file';
import { Plan } from './type';

export const loadPlan = async (path: string, deployer: Address): Promise<Plan> => {
  const plan = await loadYaml(path);

  let deployerMatch: boolean | undefined;
  if (plan[DEPLOYER_KEY] != null) {
    if (!isHex(plan[DEPLOYER_KEY])) {
      throw new Error(`Plan "${DEPLOYER_KEY}" must be a hex string`);
    }
    deployerMatch = isAddressEqual(plan[DEPLOYER_KEY], deployer);
  }

  console.log();
  console.log('Plan:');
  console.log(
    '- deployer:' +
      (deployerMatch == null ? 'no specific one expected 👻' : `${plan[DEPLOYER_KEY]} ${deployerMatch ? '✅' : '❌'}`),
  );

  if (deployerMatch === false) {
    throw new Error('Config deployer does not match deployer expected by plan');
  }

  return plan as Plan;
};
