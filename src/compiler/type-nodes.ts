/** Conversion of inline type syntax (TypeNode AST) into the semantic type model. */
import { makeUnion, T, type Type, type TypeNode } from '#core';

export function typeFromNode(node: TypeNode): Type {
  switch (node.kind) {
    case 'prim':
      switch (node.name) {
        case 'string':
          return T.string;
        case 'number':
          return T.number;
        case 'boolean':
          return T.boolean;
        case 'null':
          return T.null;
        case 'unknown':
          return T.unknown;
      }
      break;
    case 'lit':
      return T.literal(node.value);
    case 'array':
      return T.array(typeFromNode(node.element));
    case 'object':
      return T.object(
        node.fields.map((f) => ({
          name: f.name,
          type: typeFromNode(f.type),
          optional: f.optional,
        })),
      );
    case 'union':
      return makeUnion(node.types.map(typeFromNode));
  }
}
