import { AbiFunction, AbiParameter } from 'abitype';

import { Artifact, ArtifactRegistry, Deploy, DeployValue, ResolvedValue, Value } from './type';
import {
  CALL_ARTIFACT,
  CALL_FORCE_SUFFIX,
  CALL_PREFIX,
  CALL_SIGNATURE,
  INPUT_PREFIXES,
  INPUT_SUFFIXES,
  REFERENCE_PREFIX,
  REFERENCE_SEPARATOR,
} from './constant';

export const resolveCall = (name: string): string => {
  name = name.slice(CALL_PREFIX.length);
  if (name.endsWith(CALL_FORCE_SUFFIX)) {
    name = name.slice(0, -CALL_FORCE_SUFFIX.length);
  }
  return name;
};

export const resolveReference = (reference: string, chainName: string): string[] => {
  const path = reference.slice(REFERENCE_PREFIX.length).split(REFERENCE_SEPARATOR);
  path[0] ||= chainName;
  return path;
};

export const createReference = (path: readonly string[]): string => {
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

export const resolveArtifact = (
  name: string,
  artifactPath: string | undefined,
  artifacts: ArtifactRegistry,
  description: string,
): Artifact => {
  const artifact = artifacts.artifacts.get(name);
  if (artifact != null) {
    return artifact;
  }

  const paths = artifacts.resolutions.get(name);
  if (paths == null) {
    throw new Error(`${description} missing artifact for "${name}"`);
  }

  if (paths.size === 1) {
    const path = [...paths][0];
    const artifact = artifacts.artifacts.get(path)!;
    return artifact;
  }

  if (!artifactPath) {
    throw new Error(
      `${description} usage of "${name}" must specify artifact path field ` +
      `"${CALL_ARTIFACT}" to resolve ambiguity among ${paths.size} path candidates ` +
      `(${[...paths].sort().map((s) => `"${s}"`).join(', ')})`
    );
  }

  const tryPath = (path: string): Artifact | null => {
    if (!paths.has(path)) {
      return null;
    }

    const artifact = artifacts.artifacts.get(path)!;
    return artifact;
  };

  const badPath = (): never => {
    throw new Error(
      `${description} usage of "${name}" specifies artifact path ` +
      `"${artifactPath}" that could not be matched with any of ${paths.size} path candidates ` +
      `(${[...paths].sort().map((s) => `"${s}"`).join(', ')})`
    );
  };

  return (
    tryPath(artifactPath) ??
    tryPath(`${artifactPath}/${name}.sol/${name}.json`) ??
    tryPath(`${artifactPath}.sol/${name}.json`) ??
    tryPath(`${artifactPath}/${name}.json`) ??
    tryPath(`${artifactPath}.json`) ??
    badPath()
  );
};

export const resolveFunction = (
  name: string,
  targetName: string,
  signature: string | undefined,
  artifact: Artifact,
  description: string,
): AbiFunction => {
  const func = artifact.functions.get(name);
  if (func != null) {
    return func;
  }

  const signatures = artifact.resolutions.get(name);
  if (signatures == null) {
    throw new Error(`${description} targets function "${name}" missing in artifact "${targetName}"`);
  }

  if (signatures.size === 1) {
    const signature = [...signatures][0];
    const func = artifact.functions.get(signature)!;
    return func;
  }

  if (!signature) {
    throw new Error(
      `${description} to function "${name}" of artifact "${targetName}" must specify ` +
      `signature field "${CALL_SIGNATURE}" to resolve ambiguity among ${signatures.size} overload candidates ` +
      `(${[...signatures].sort().map((s) => `"${s}"`).join(', ')})`
    );
  }

  const trySignature = (signature: string): AbiFunction | null => {
    if (!signatures.has(signature)) {
      return null;
    }

    const func = artifact.functions.get(signature)!;
    return func;
  };

  const badSignature = (): never => {
    throw new Error(
      `${description} to function "${name}" of artifact "${targetName}" specifies signature ` +
      `"${signature}" that could not be matched with any of ${signatures.size} overload candidates ` +
      `(${[...signatures].sort().map((s) => `"${s}"`).join(', ')})`
    );
  };

  return (
    trySignature(signature) ??
    trySignature(name + signature) ??
    trySignature(`${name}(${signature})`) ??
    badSignature()
  );
};

export const resolveValue = (
  value: Value,
  deploys: ReadonlyMap<string, Deploy>,
): ResolvedValue => {
  if (value instanceof DeployValue) {
    const reference = createReference(value.path);
    const deploy = deploys.get(reference);
    if (deploy != null) {
      return deploy.address;
    }
    throw new Error(`Failed to resolve deploy contract reference "${reference}"`);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((subvalue) => resolveValue(subvalue, deploys));
  }

  return Object.fromEntries(
    Object.entries(value).map(
      ([name, subvalue]) => [name, resolveValue(subvalue, deploys)],
    ),
  );
};

export const resolveArguments = (
  args: ReadonlyMap<string, Value>,
  inputs: readonly AbiParameter[],
  deploys: ReadonlyMap<string, Deploy>,
  description: string,
): ResolvedValue[] => {
  const values: ResolvedValue[] = [];
  for (const input of inputs) {
    if (!input.name) {
      throw new Error(`ABI input for ${description} has "name" missing`);
    }

    const name = resolveInput(input.name);
    const arg = args.get(name);
    if (arg == null) {
      throw new Error(`Argument "${name}" was not provided for ${description}`);
    }

    const value = resolveValue(arg, deploys);
    values.push(value);
  }
  return values;
};
