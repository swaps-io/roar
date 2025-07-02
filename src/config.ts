import { isHex, size } from 'viem';

import { DEFAULT_DRY_RUN, DEFAULT_NONCE_BEHIND_RETRIES, DEFAULT_RETRY_DELAY } from './constant';
import { getDeployerAddress } from './deployer';
import { loadYaml } from './file';
import { Config } from './type';
import { joinComma } from './util';

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

  if (config.rpc == null) {
    config.rpc = {};
  } else if (typeof config.rpc !== 'object' || Array.isArray(config.rpc)) {
    throw new Error('Invalid config "rpc" field (object expected)');
  }

  for (const [name, rpc] of Object.entries(config.rpc)) {
    switch (name) {
      case 'url':
        if (typeof rpc !== 'string') {
          throw new Error(`Invalid config "url" field of "rpc" (string expected)`);
        }
        continue;

      case 'show':
        if (typeof rpc !== 'boolean') {
          throw new Error(`Invalid config "show" field of "rpc" (boolean expected)`);
        }
        continue;
    }

    if (rpc == null || typeof rpc !== 'object' || Array.isArray(rpc)) {
      throw new Error(`Invalid config "${name}" field of "rpc" (object expected)`);
    }

    if (!('id' in rpc) || typeof rpc.id !== 'number') {
      throw new Error(`Invalid config "id" in "${name}" field of "rpc" (number expected)`);
    }

    if ('url' in rpc) {
      if (rpc.url == null) {
        delete rpc.url;
      } else if (typeof rpc.url !== 'string') {
        throw new Error(`Invalid config "url" in "${name}" field of "rpc" (string expected)`);
      }
    }

    if ('show' in rpc) {
      if (rpc.show == null) {
        delete rpc.show;
      } else if (typeof rpc.show !== 'boolean') {
        throw new Error(`Invalid config "show" in "${name}" field of "rpc" (boolean expected)`);
      }
    }
  }

  const rpcIds = Object.entries(config.rpc as object)
    .filter(([key]) => key !== 'url' && key !== 'show')
    .map(([, value]) => `${value.id}`);

  console.log();
  console.log('Config:');
  console.log(`- deployer: ${getDeployerAddress(config.deployer.privateKey)}`);
  console.log(`- dry run: ${config.execution.dryRun ? 'enabled 🏜️' : 'disabled 🚨'}`);
  console.log(`- retry delay: ${config.execution.retryDelay} ms`);
  console.log(`- nonce behind retries: ${config.execution.nonceBehindRetries}`);
  console.log(`- custom rpc (${rpcIds.length}): ${rpcIds.length ? joinComma(rpcIds) : 'none'}`);
  return config as Config;
};
