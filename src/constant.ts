export const DEFAULT_PLAN_PATH = 'plan.yaml';
export const DEFAULT_CONFIG_PATH = 'config.yaml';
export const DEFAULT_ARTIFACTS_PATH = 'artifacts';
export const DEFAULT_LOCKS_PATH = 'locks';
export const DEFAULT_SPEC_PATH = '';

export const CALL_PREFIX = '$';
export const CALL_TARGET = '$';
export const CALL_SIGNATURE = '$sig';
export const CALL_VALUE = '$val';
export const CALL_ARTIFACT = '$art';
export const CALL_IGNORES = new Set([CALL_TARGET, CALL_SIGNATURE, CALL_VALUE, CALL_ARTIFACT]);
export const CALL_FORCE_SUFFIX = '$';

export const REFERENCE_PREFIX = '$';
export const REFERENCE_SEPARATOR = '.';

export const INPUT_PREFIXES = ['_'];
export const INPUT_SUFFIXES = ['_'];

export const DEFAULT_DRY_RUN = true;
export const DEFAULT_RETRY_DELAY = 8_000; // 8 secs
export const DEFAULT_NONCE_BEHIND_RETRIES = 15; // * 8 secs = 2 mins
