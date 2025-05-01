import { isHex, size } from 'viem';

import { DEFAULT_DRY_RUN, DEFAULT_NONCE_BEHIND_RETRIES, DEFAULT_RETRY_DELAY } from './constant';
import { getDeployerAddress } from './deployer';
import { loadYaml } from './file';
import { Config } from './type';

export const loadConfig = async (path: string): Promise<Config> => {
  const config = await loadYaml(path);

  if (config.deployer == null) {
    config.deployer = {};
  } else if (typeof config.deployer !== 'object' || Array.isArray(config.deployer)) {
    throw new Error('Invalid config "deployer" field (object expected)');
  }

  if (!isHex(config.deployer.privateKey)) {
    throw new Error('Invalid config "privateKey" field of "deployer" (hex string expected)');
  }

  const keySize = size(config.deployer.privateKey);
  const expectedKeySize = 32;
  if (keySize !== expectedKeySize) {
    throw new Error(
      `Invalid byte size of config "privateKey" field of "deployer" (${expectedKeySize} expected, got ${keySize})`,
    );
  }

  if (config.execution == null) {
    config.execution = {};
  } else if (typeof config.execution !== 'object' || Array.isArray(config.execution)) {
    throw new Error('Invalid config "execution" field (object expected)');
  }

  if (config.execution.dryRun == null) {
    config.execution.dryRun = DEFAULT_DRY_RUN;
  } else if (typeof config.execution.dryRun !== 'boolean') {
    throw new Error('Invalid config "dryRun" field of "execution" (boolean expected)');
  }

  if (config.execution.retryDelay == null) {
    config.execution.retryDelay = DEFAULT_RETRY_DELAY;
  } else if (typeof config.execution.retryDelay !== 'number' || config.execution.retryDelay < 0) {
    throw new Error('Invalid config "retryDelay" field of "execution" (non-negative number expected)');
  }

  if (config.execution.nonceBehindRetries == null) {
    config.execution.nonceBehindRetries = DEFAULT_NONCE_BEHIND_RETRIES;
  } else if (typeof config.execution.nonceBehindRetries !== 'number' || config.execution.nonceBehindRetries < 0) {
    throw new Error('Invalid config "nonceBehindRetries" field of "execution" (non-negative number expected)');
  }

  console.log();
  console.log('Config:');
  console.log(`- deployer: ${getDeployerAddress(config.deployer.privateKey)}`);
  console.log(`- dry run: ${config.execution.dryRun ? 'enabled 🏜️' : 'disabled 🚨'}`);
  console.log(`- retry delay: ${config.execution.retryDelay} ms`);
  console.log(`- nonce behind retries: ${config.execution.nonceBehindRetries}`);
  return config as Config;
};
