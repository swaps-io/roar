import { Hex, encodeFunctionData, toFunctionSelector, toFunctionSignature } from 'viem';

import { resolveArguments, resolveArtifact, resolveFunction } from './resolve';
import { ArtifactRegistry, DeployRegistry, Value, ViemValue } from './type';

export interface EncodeCallParams {
  name?: string;
  targetName: string;
  args: Map<string, Value>;
  signature: string | undefined;
  artifact: string | undefined;
  deploys: DeployRegistry;
  artifacts: ArtifactRegistry;
  description: string;
}

export interface EncodeCallResult {
  data: Hex;
  args: ViemValue[];
  artifact: string;
  signature: string;
  selector: string;
}

export const encodeCall = (params: EncodeCallParams): EncodeCallResult => {
  const artifact = resolveArtifact(params.targetName, params.artifact, params.artifacts, params.description);
  const func = resolveFunction(params.name, params.targetName, params.signature, artifact, params.description);

  const abi = [func] as const;
  const inputs = abi.flatMap((a) => a.inputs);
  const args = resolveArguments({
    args: params.args,
    inputs,
    deploys: params.deploys,
    artifacts: params.artifacts,
    description: params.description,
  });

  const data = encodeFunctionData({
    abi,
    args,
  });

  const result: EncodeCallResult = {
    data,
    args,
    artifact: artifact.path,
    signature: toFunctionSignature(abi[0]),
    selector: toFunctionSelector(abi[0]),
  };
  return result;
};
