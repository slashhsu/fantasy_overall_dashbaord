import { XMLParser } from "fast-xml-parser";

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export const parseXml = (xml: string) => parser.parse(xml) as XmlNode;

export const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

export const objectValue = (value: unknown): XmlNode =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as XmlNode) : {};

export const textValue = (value: unknown, fallback = "") => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"] ?? fallback);
  }
  return fallback;
};

export const findAll = (value: unknown, key: string): XmlNode[] => {
  const found: XmlNode[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [nodeKey, child] of Object.entries(node as XmlNode)) {
      if (nodeKey === key) {
        for (const item of asArray(child)) found.push(objectValue(item));
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return found;
};

export const directChildren = (value: unknown, container: string, child: string): XmlNode[] => {
  const node = objectValue(value);
  const parent = objectValue(node[container]);
  return asArray(parent[child]).map(objectValue);
};
