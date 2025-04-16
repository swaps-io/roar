import { Dirent } from 'fs';
import fs from 'fs/promises';
import fp from 'path';
import yaml from 'js-yaml';

export const checkFileExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

export const parseDirectory = (path: string): string => {
  return fp.parse(path).dir;
};

export const joinPath = (...paths: readonly string[]): string => {
  return fp.join(...paths);
};

export const createDirectory = async (path: string): Promise<void> => {
  await fs.mkdir(path, { recursive: true });
};

export const discoverDirectoryEntries = async (path: string): Promise<Dirent[]> => {
  const entries = await fs.readdir(path, { recursive: true, withFileTypes: true });
  return entries;
};

export const createFileDirectory = async (path: string): Promise<void> => {
  const fileExists = await checkFileExists(path);
  if (fileExists) {
    return;
  }

  const directory = parseDirectory(path);
  if (!directory) {
    return;
  }

  const directoryExists = await checkFileExists(directory);
  if (directoryExists) {
    return;
  }

  await createDirectory(directory);
};

//

export const loadText = async (path: string): Promise<string> => {
  const text = await fs.readFile(path, 'utf-8');
  return text;
};

export const loadYaml = async (path: string): Promise<any> => {
  const text = await loadText(path);
  const object = yaml.load(text);
  return object;
};

export const loadJson = async (path: string): Promise<any> => {
  const text = await loadText(path);
  const object = JSON.parse(text);
  return object;
};

//

export const saveText = async (path: string, text: string): Promise<void> => {
  await fs.writeFile(path, text);
};

export const saveYaml = async (path: string, object: any): Promise<void> => {
  const text = yaml.dump(object);
  await saveText(path, text);
};

export const saveJson = async (path: string, object: any): Promise<void> => {
  const text = JSON.stringify(object);
  await saveText(path, text);
};
