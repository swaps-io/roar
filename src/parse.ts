import { Hex, isHex } from 'viem';

import { CALL_PREFIX, CALL_IGNORES, CALL_FORCE_SUFFIX, REFERENCE_PREFIX } from './constant';

const isUpperCase = (value: string): boolean => {
  return ( // 2 checks to handle digits etc
    value === value.toUpperCase() &&
    value !== value.toLowerCase()
  );
};

export const isContract = (name: string): boolean => {
  const start = name.slice(0, 1); // First character
  return isUpperCase(start);
};

export const isContractAddress = (value: unknown): value is Hex => {
  return isHex(value);
};

export const isCall = (name: string): boolean => {
  if (!name.startsWith(CALL_PREFIX)) {
    return false;
  }

  if (!CALL_IGNORES.has(name)) {
    return true;
  }

  if (name.endsWith(CALL_FORCE_SUFFIX) && name !== CALL_FORCE_SUFFIX) {
    return true;
  }

  return false;
};

export const isReference = (name: string): boolean => {
  return name.startsWith(REFERENCE_PREFIX);
};
