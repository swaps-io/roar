export const mapPop = <K, V>(map: Map<K, V>, key: K): V | undefined => {
  const item = map.get(key);
  map.delete(key);
  return item;
};

export const jsonStringify = (value: any, prettify = false): string => {
  return JSON.stringify(value, jsonReplacer, prettify ? 2 : undefined);
};

const jsonReplacer = (key: string, value: any): any => {
  return typeof value === 'bigint' ? value.toString() : value;
};
