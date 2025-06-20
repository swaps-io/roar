import { Hex, encodeDeployData } from 'viem';

import { resolveArguments, resolveArtifact } from './resolve';
import { ArtifactRegistry, DeployRegistry, Value, ViemValue } from './type';

export interface EncodeDeployParams {
  name: string;
  args: Map<string, Value>;
  artifact: string | undefined;
  deploys: DeployRegistry;
  artifacts: ArtifactRegistry;
  description: string;
}

export interface EncodeDeployResult {
  data: Hex;
  args: ViemValue[];
  artifact: string;
}

export const encodeDeploy = (params: EncodeDeployParams): EncodeDeployResult => {
  const artifact = resolveArtifact(params.name, params.artifact, params.artifacts, params.description);

  const abi = artifact.constructor == null ? [] : [artifact.constructor];
  const bytecode = artifact.bytecode;
  const inputs = abi.flatMap((a) => a.inputs);
  const args = resolveArguments({
    args: params.args,
    inputs,
    deploys: params.deploys,
    artifacts: params.artifacts,
    description: params.description,
  });

  const data = encodeDeployData({
    bytecode,
    abi,
    args,
  });

  const result: EncodeDeployResult = {
    data,
    args,
    artifact: artifact.path,
  };
  return result;
};
