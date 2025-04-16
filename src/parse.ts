import { Hex, isHex } from 'viem';

import { CALL_PREFIX, REFERENCE_PREFIX, REFERENCE_SEPARATOR, INPUT_PREFIXES, INPUT_SUFFIXES } from './constant';

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
  return name.startsWith(CALL_PREFIX);
};

export const resolveCall = (name: string): string => {
  return name.slice(CALL_PREFIX.length);
};

export const isReference = (name: string): boolean => {
  return name.startsWith(REFERENCE_PREFIX);
};

export const resolveReference = (reference: string, chainName: string): string[] => {
  const path = reference.slice(REFERENCE_PREFIX.length).split(REFERENCE_SEPARATOR);
  path[0] ||= chainName;
  return path;
};

export const serializeReference = (path: readonly string[]): string => {
  return REFERENCE_PREFIX + path.join(REFERENCE_SEPARATOR);
};

export const resolveInput = (name: string): string => {
  let keepResolving = true;
  while (keepResolving) {
    keepResolving = false;
    for (const prefix of INPUT_PREFIXES) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        keepResolving = true;
      }
    }
    for (const suffix of INPUT_SUFFIXES) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        keepResolving = true;
      }
    }
  }
  return name;
};
