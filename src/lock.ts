import { checkFileExists, createFileDirectory, loadYaml, saveYaml } from './file';
import { Lock } from './type';

export const loadLock = async (path: string): Promise<Lock | null> => {
  console.log();
  console.log('Lock:');
  console.log(`- path: ${path}`);

  const lockExists = await checkFileExists(path);
  console.log(`- status: ${lockExists ? 'exists 🪺' : 'does not exist 🪹'}`);
  if (!lockExists) {
    return null;
  }

  const lock = await loadYaml(path);

  if (typeof lock.nonces !== 'object' || Array.isArray(lock.nonces)) {
    throw new Error('Invalid lock "nonces" field (object expected)');
  }

  for (const nonce of Object.values(lock.nonces)) {
    if (typeof nonce !== 'number' || nonce < 0) {
      throw new Error('Invalid lock "nonces" field value (non-negative number expected)');
    }
  }

  console.log(`- chain nonces (${Object.keys(lock.nonces).length}):`);
  for (const [chainName, nonce] of Object.entries(lock.nonces)) {
    console.log(`  - ${chainName}: ${nonce}`);
  }
  return lock as Lock;
};

export const saveLock = async (path: string, lock: Lock): Promise<void> => {
  console.log();
  console.log('Lock save:');
  console.log(`- path: ${path}`);
  console.log(`- chain nonces (${Object.keys(lock.nonces).length}):`);
  for (const [chainName, nonce] of Object.entries(lock.nonces)) {
    console.log(`  - ${chainName}: ${nonce}`);
  }

  await createFileDirectory(path);
  await saveYaml(path, lock);
  console.log('- status: saved 🪺');
};
