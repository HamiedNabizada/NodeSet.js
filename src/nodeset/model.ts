// The in-memory form of OPC UA NodeSet2 files (OPC 10000-6 Annex F).
//
// A NodeId is identified by its namespace URI, never by an index: an index
// is only valid within one file or one session. The key of a NodeId is
// "<namespace URI>|<identifier>", with the identifier as NodeSets write it
// ("i=85", "s=Pump", "g=...", "b=...").
//
// What the modeler does not edit is kept as it was read (Value, Definition,
// Extensions, attributes it does not know), so a file it only reads comes
// back with the same content.

export const UA_NAMESPACE = 'http://opcfoundation.org/UA/';

export type NodeClass =
  | 'Object'
  | 'ObjectType'
  | 'Variable'
  | 'VariableType'
  | 'DataType'
  | 'ReferenceType'
  | 'Method'
  | 'View';

export const NODE_CLASSES: readonly NodeClass[] = [
  'Object', 'ObjectType', 'Variable', 'VariableType', 'DataType', 'ReferenceType', 'Method', 'View',
];

export interface NodeId {
  readonly namespaceUri: string;
  /** As NodeSets write it: "i=85", "s=Pump", "g=…", "b=…". */
  readonly identifier: string;
}

export function nodeIdKey(id: NodeId): string {
  return `${id.namespaceUri}|${id.identifier}`;
}

export function parseNodeIdKey(key: string): NodeId {
  const bar = key.lastIndexOf('|');
  return { namespaceUri: key.slice(0, bar), identifier: key.slice(bar + 1) };
}

/** A NodeId of the UA base namespace, as a key: uaKey(85) is the Objects folder. */
export function uaKey(numeric: number): string {
  return `${UA_NAMESPACE}|i=${numeric}`;
}

export interface QualifiedName {
  readonly namespaceUri: string;
  readonly name: string;
}

export interface LocalizedText {
  readonly text: string;
  readonly locale?: string;
}

export interface Reference {
  /** Key of the ReferenceType. */
  type: string;
  isForward: boolean;
  /** Key of the other node. */
  target: string;
}

/** An element of InputArguments or OutputArguments (the Argument structure, OPC 10000-3 8.6). */
export interface Argument {
  name: string;
  /** Key of the DataType. */
  dataType: string;
  valueRank: number;
  arrayDimensions: number[];
  description?: LocalizedText;
}

/** A field of a structure or enumeration DataType (OPC 10000-6 F.12). */
export interface DefinitionField {
  name: string;
  /** Structures: key of the field's DataType. */
  dataType?: string;
  valueRank?: number;
  arrayDimensions?: string;
  /** Enumerations and OptionSets: the value. */
  value?: number;
  isOptional?: boolean;
  description: LocalizedText[];
  displayName: LocalizedText[];
  otherAttributes: Record<string, string>;
}

export interface DataTypeDefinition {
  name: QualifiedName;
  fields: DefinitionField[];
  /** IsUnion, IsOptionSet, SymbolicName … as read. */
  otherAttributes: Record<string, string>;
}

export interface UaNode {
  /** Key of the NodeId, see nodeIdKey. */
  id: string;
  nodeClass: NodeClass;
  browseName: QualifiedName;
  displayName: LocalizedText[];
  description: LocalizedText[];
  references: Reference[];
  /** Key of the parent, as ParentNodeId in the file. */
  parent?: string;
  symbolicName?: string;
  isAbstract?: boolean;
  /** ReferenceType */
  symmetric?: boolean;
  inverseName?: LocalizedText[];
  /** Variable and VariableType: key of the DataType. */
  dataType?: string;
  valueRank?: number;
  arrayDimensions?: string;
  accessLevel?: number;
  /** Raw inner XML of the Value element, written back unchanged. */
  valueXml?: string;
  /**
   * InputArguments and OutputArguments: the value as Arguments. When set, it
   * replaces valueXml on writing, because the XML holds namespace indexes.
   */
  arguments?: Argument[];
  /** DataType: the Definition, with DataTypes as keys. */
  definition?: DataTypeDefinition;
  /** Attributes of the element the model does not name, kept for writing. */
  otherAttributes: Record<string, string>;
  /** Child elements the model does not name (Extensions, Documentation, RolePermissions …), raw. */
  otherElements: string[];
}

export interface ModelInfo {
  modelUri: string;
  version?: string;
  publicationDate?: string;
  requiredModels: { modelUri: string; version?: string; publicationDate?: string }[];
  otherAttributes: Record<string, string>;
}

/** One NodeSet2 file. */
export interface NodeSetFile {
  /** The file's namespace table: index 1 is namespaceUris[0]; index 0 is always UA. */
  namespaceUris: string[];
  serverUris: string[];
  models: ModelInfo[];
  /** Alias name → NodeId key. */
  aliases: Map<string, string>;
  nodes: UaNode[];
  lastModified?: string;
  /** Root attributes and elements the model does not name, kept for writing. */
  otherAttributes: Record<string, string>;
  otherElements: string[];
}

export function text(values: LocalizedText[] | undefined): string {
  return values && values.length > 0 ? values[0].text : '';
}
