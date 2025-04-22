import yaml from 'js-yaml';

export const mapPop = <K, V>(map: Map<K, V>, key: K): V | undefined => {
  const item = map.get(key);
  map.delete(key);
  return item;
};

export const jsonStringify = (value: any, prettify = false): string => {
  return JSON.stringify(value, replacer, prettify ? 2 : undefined);
};

export const yamlDump = (value: any): string => {
  return yaml.dump(value, { lineWidth: -1, replacer });
};

export const joinComma = (strings: readonly string[]): string => {
  return strings.join(', ');
};

const replacer = (key: string, value: any): any => {
  return typeof value === 'bigint' ? value.toString() : value;
};
