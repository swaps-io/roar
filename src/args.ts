
import { Args } from './type';
import {
  DEFAULT_PLAN_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_ARTIFACTS_PATH,
  DEFAULT_LOCKS_PATH,
  DEFAULT_SPEC_PATH,
} from './constant';

export const parseArgs = (): Args => {
  console.log();
  console.log('Roar 🏎️');
  console.log();

  const usage = (): never => {
    throw new Error(
      'Usage: roar ' +
      '[--plan <plan-path>] ' +
      '[--config <config-path>] ' +
      '[--artifacts <artifacts-path>] ' +
      '[--locks <locks-path>]',
    );
  };

  const args: Args = {
    configPath: DEFAULT_CONFIG_PATH,
    planPath: DEFAULT_PLAN_PATH,
    artifactsPath: DEFAULT_ARTIFACTS_PATH,
    locksPath: DEFAULT_LOCKS_PATH,
    specPath: DEFAULT_SPEC_PATH,
  };

  const getArgValue = (index: number): string => {
    const value = process.argv[index];
    return value || usage();
  }

  const getArg = (index: number): void => {
    switch (process.argv[index]) {
      case '--plan':
      case '-p':
        args.planPath = getArgValue(index + 1);
        return;

      case '--config':
      case '-c':
        args.configPath = getArgValue(index + 1);
        return;

      case '--artifacts':
      case '-a':
        args.artifactsPath = getArgValue(index + 1);
        return;

      case '--locks':
      case '-l':
        args.locksPath = getArgValue(index + 1);
        return;

      case '--spec':
      case '-s':
        args.specPath = getArgValue(index + 1);
        return;

      default:
        usage();
    }
  };

  for (let index = 2; index < process.argv.length; index += 2) {
    getArg(index);
  }

  console.log('Arguments:');
  console.log(`- plan path: ${args.planPath}`);
  console.log(`- config path: ${args.configPath}`);
  console.log(`- artifacts path: ${args.artifactsPath}`);
  console.log(`- locks path: ${args.locksPath}`);
  console.log(`- spec path: ${args.specPath || 'none ❎'}`);
  return args;
};
