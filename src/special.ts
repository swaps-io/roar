import { isAddress, isContract } from './parse';
import { createReference } from './resolve';
import { CallTarget, DeployValue, TransferTarget, Value } from './type';

export const asArgsSpecial = (value: Value, path: readonly string[]): Map<string, Value> => {
  if (typeof value !== 'object' || Array.isArray(value) || value instanceof DeployValue) {
    throw new Error(`Invalid arguments evaluated at "${createReference(path)}": object expected`);
  }

  const args = new Map(Object.entries(value));
  return args;
};

const asTargetAddress = (value: Value | undefined, path: readonly string[]): string | DeployValue => {
  if (value == null) {
    throw new Error(`Invalid call target evaluated at "${createReference(path)}": non-empty expected`);
  }

  if (!isAddress(value) && !(value instanceof DeployValue)) {
    throw new Error(
      `Invalid call target evaluated at "${createReference(path)}": contract address or reference expected`,
    );
  }

  return value;
};

const asTargetName = (
  value: Value | undefined,
  path: readonly string[],
  getSubpath: () => readonly string[] | null,
): string => {
  if (value instanceof DeployValue) {
    const name = value.path[value.path.length - 1];
    return name;
  }

  const subpath = getSubpath();
  if (subpath == null) {
    throw new Error(`Invalid call target evaluated at "${createReference(path)}": non-empty reference expected`);
  }

  const name = subpath[subpath.length - 1];
  if (!isContract(name)) {
    throw new Error(
      `Invalid call target evaluated at "${createReference(path)}": ` +
        `reference must end in contract name, which "${name}" is not`,
    );
  }

  return name;
};

export const asTransferTargetSpecial = (value: Value | undefined, path: readonly string[]): TransferTarget => {
  const address = asTargetAddress(value, path);

  const target: TransferTarget = {
    address,
  };
  return target;
};

export const asCallTargetSpecial = (
  value: Value | undefined,
  path: readonly string[],
  getSubpath: () => readonly string[] | null,
): CallTarget => {
  const address = asTargetAddress(value, path);
  const name = asTargetName(value, path, getSubpath);

  const target: CallTarget = {
    name,
    address,
  };
  return target;
};

export const asValueSpecial = (value: Value | undefined, path: readonly string[]): bigint | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') {
    throw new Error(`Invalid payable value evaluated at "${createReference(path)}": number or string expected`);
  }

  let payableValue: bigint;
  try {
    payableValue = BigInt(value);
  } catch {
    throw new Error(`Invalid payable value evaluated at "${createReference(path)}": not convertible to bigint`);
  }

  if (payableValue < 0n) {
    throw new Error(`Invalid payable value evaluated at "${createReference(path)}": non-negative integer expected`);
  }

  return payableValue > 0n ? payableValue : undefined;
};

export const asSignatureSpecial = (value: Value | undefined, path: readonly string[]): string | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid function signature evaluated at "${createReference(path)}": string expected`);
  }

  return value;
};

export const asArtifactSpecial = (value: Value | undefined, path: readonly string[]): string | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid artifact path evaluated at "${createReference(path)}": string expected`);
  }

  return value;
};
