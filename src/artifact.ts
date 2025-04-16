import { isHex, toFunctionSignature } from 'viem';
import { AbiConstructor, AbiFunction } from 'abitype';

import { Artifact } from './type';
import { loadJson, joinPath, discoverDirectoryEntries } from './file';

const discoverArtifactPaths = async (path: string): Promise<Map<string, string>> => {
  const entries = await discoverDirectoryEntries(path);
  const artifactPaths = new Map<string, string>();
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.parentPath.endsWith('.sol') &&
      entry.name.endsWith('.json')
    ) {
      const artifactName = entry.name.slice(0, -'.json'.length);
      const artifactPath = joinPath(entry.parentPath, entry.name);
      const existingPath = artifactPaths.get(artifactName);
      if (existingPath != null) {
        throw new Error(`Artifact "${artifactName}" path duplicate ("${artifactPath}" vs "${existingPath}")`);
      }
      artifactPaths.set(artifactName, artifactPath);
    }
  }
  return artifactPaths;
};

const loadArtifact = async (name: string, path: string): Promise<Artifact> => {
  const content = await loadJson(path);
  if (content.contractName !== name) {
    throw new Error(`Artifact at "${path}" has mismatching "contractName" value ("${name}" expected)`);
  }

  if (typeof content.sourceName !== 'string') {
    throw new Error(`Artifact at "${path}" has unexpected "sourceName" value type (string expected)`);
  }

  if (!isHex(content.bytecode)) {
    throw new Error(`Artifact at "${path}" has unexpected "bytecode" value type (hex string expected)`);
  }

  if (!Array.isArray(content.abi)) {
    throw new Error(`Artifact at "${path}" has unexpected "abi" value type (array expected)`);
  }

  let constructor: AbiConstructor | undefined;
  const functions = new Map<string, AbiFunction>();
  const resolutions = new Map<string, Set<string>>();
  for (const abi of content.abi) {
    switch (abi.type) {
      case 'constructor':
        constructor = abi;
        break;

      case 'function':
        const signature = toFunctionSignature(abi);

        const sizeBefore = functions.size;
        functions.set(signature, abi);
        if (functions.size === sizeBefore) {
          throw new Error(`Artifact at "${path}" has function "${signature}" duplicate in "abi"`);
        }

        const signatures = resolutions.get(abi.name);
        if (signatures == null) {
          resolutions.set(abi.name, new Set([signature]));
        } else {
          signatures.add(signature);
        }
        break;
    }
  }

  const artifact: Artifact = {
    name,
    source: content.sourceName,
    bytecode: content.bytecode,
    constructor,
    functions,
    resolutions,
  };
  return artifact;
}

export const loadArtifacts = async (path: string): Promise<Map<string, Artifact>> => {
  const artifactPaths = await discoverArtifactPaths(path);
  const artifacts = new Map<string, Artifact>();
  await Promise.all(artifactPaths.entries().map(async ([name, path]) => {
    const artifact = await loadArtifact(name, path);
    artifacts.set(name, artifact);
  }));
  return artifacts;
};
