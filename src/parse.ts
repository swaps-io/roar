import { Address, isAddress as isAddressViem } from 'viem';

import { CALL_PREFIX, CALL_IGNORES, CALL_TRANSFER, REFERENCE_PREFIX } from './constant';

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

export const isAddress = (value: unknown): value is Address => {
  return typeof value === 'string' && isAddressViem(value);
};

export const isCall = (name: string): boolean => {
  if (!name.startsWith(CALL_PREFIX)) {
    return false;
  }

  if (CALL_IGNORES.has(name)) {
    return false;
  }

  return true;
};

export const isTransfer = (name: string): boolean => {
  return name === CALL_TRANSFER;
};

export const isReference = (name: string): boolean => {
  return name.startsWith(REFERENCE_PREFIX);
};
