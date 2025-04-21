import { isHex, toFunctionSignature } from 'viem';
import { AbiConstructor, AbiFunction } from 'abitype';

import { Artifact, ArtifactRegistry } from './type';
import { loadJson, joinPath, discoverDirectoryEntries } from './file';

const discoverArtifactPaths = async (path: string): Promise<string[]> => {
  const entries = await discoverDirectoryEntries(path);
  const artifactPaths: string[] = [];
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.parentPath.endsWith('.sol') &&
      entry.name.endsWith('.json') &&
      !entry.name.endsWith('.dbg.json')
    ) {
      const artifactPath = joinPath(entry.parentPath, entry.name);
      artifactPaths.push(artifactPath);
    }
  }
  return artifactPaths;
};

const loadArtifact = async (path: string): Promise<Artifact | null> => {
  const content = await loadJson(path);

  if (typeof content.contractName !== 'string') {
    throw new Error(`Artifact at "${path}" has unexpected "contractName" value (string expected)`);
  }

  if (typeof content.sourceName !== 'string') {
    throw new Error(`Artifact at "${path}" has unexpected "sourceName" value type (string expected)`);
  }

  if (content.linkReferences == null || typeof content.linkReferences !== 'object' || Array.isArray(content.linkReferences)) {
    throw new Error(`Artifact at "${path}" has unexpected "linkReferences" value type (object expected)`);
  }

  if (Object.keys(content.linkReferences).length > 0) {
    return null; // Skipping artifact - its bytecode requires linking against libraries, which is not supported
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
    name: content.contractName,
    path,
    source: content.sourceName,
    bytecode: content.bytecode,
    constructor,
    functions,
    resolutions,
  };
  return artifact;
}

export const loadArtifacts = async (path: string): Promise<ArtifactRegistry> => {
  const artifactPaths = await discoverArtifactPaths(path);

  const artifacts = new Map<string, Artifact>();
  const resolutions = new Map<string, Set<string>>();
  await Promise.all(artifactPaths.map(async (path) => {
    const artifact = await loadArtifact(path);
    if (artifact == null) {
      return;
    }

    artifacts.set(path, artifact);

    const paths = resolutions.get(artifact.name);
    if (paths == null) {
      resolutions.set(artifact.name, new Set([path]));
    } else {
      paths.add(path);
    }
  }));

  const registry: ArtifactRegistry = {
    artifacts,
    resolutions,
  };
  return registry;
};
