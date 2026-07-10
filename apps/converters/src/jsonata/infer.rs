//! Structural input-type inference from a JSONata expression (port of
//! `src/converter/jsonata/infer.ts`). Tree nodes live in an arena (indices)
//! so scopes can alias nodes like the TS object references do.

use super::parser::JNode;
use crate::util::{is_ident, json_quote};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Leaf {
    Str,
    Num,
    Bool,
    Unknown,
}

impl Leaf {
    fn name(self) -> &'static str {
        match self {
            Leaf::Str => "string",
            Leaf::Num => "number",
            Leaf::Bool => "boolean",
            Leaf::Unknown => "unknown",
        }
    }
}

struct TNode {
    leaf: Leaf,
    is_array: bool,
    fields: Vec<(String, usize)>,
}

/// JSONata functions whose first argument narrows the path it is applied to.
fn arg_shape(name: &str) -> Option<(bool, Option<Leaf>)> {
    // (array, leaf)
    Some(match name {
        "uppercase" | "lowercase" | "trim" | "length" | "substring" | "substringBefore"
        | "substringAfter" | "pad" | "contains" | "split" | "replace" | "base64encode"
        | "base64decode" | "encodeUrl" | "decodeUrl" | "encodeUrlComponent"
        | "decodeUrlComponent" | "toMillis" => (false, Some(Leaf::Str)),
        "abs" | "floor" | "ceil" | "round" | "sqrt" | "power" | "formatBase" | "fromMillis" => {
            (false, Some(Leaf::Num))
        }
        "sum" | "max" | "min" | "average" => (true, Some(Leaf::Num)),
        "join" => (true, Some(Leaf::Str)),
        "count" | "reverse" | "distinct" | "sort" | "shuffle" => (true, None),
        _ => return None,
    })
}

#[derive(Clone, Default)]
struct Scope {
    element: Option<usize>,
    element_param: Option<String>,
    /// Enclosing element node, reached by JSONata `%` (`$parent`).
    parent: Option<usize>,
    /// Lambda params bound through `$map` aliases / block `$var`s.
    params: HashMap<String, usize>,
}

fn literal_leaf(n: &JNode) -> Leaf {
    match n {
        JNode::Num(_) => Leaf::Num,
        JNode::Str(_) => Leaf::Str,
        JNode::Bool(_) => Leaf::Bool,
        _ => Leaf::Unknown,
    }
}

struct Inferrer {
    nodes: Vec<TNode>,
    root: usize,
}

impl Inferrer {
    fn make(&mut self) -> usize {
        self.nodes.push(TNode {
            leaf: Leaf::Unknown,
            is_array: false,
            fields: Vec::new(),
        });
        self.nodes.len() - 1
    }

    fn field(&mut self, base: usize, name: &str) -> usize {
        if let Some(&(_, id)) = self.nodes[base].fields.iter().find(|(k, _)| k == name) {
            return id;
        }
        let id = self.make();
        self.nodes[base].fields.push((name.to_string(), id));
        id
    }

    fn set_leaf(&mut self, id: usize, leaf: Leaf) {
        if leaf == Leaf::Unknown {
            return;
        }
        let node = &mut self.nodes[id];
        if node.leaf == Leaf::Unknown {
            node.leaf = leaf;
        } else if node.leaf != leaf {
            node.leaf = Leaf::Unknown;
        }
    }

    /// Resolve a path-shaped expression to its tree node, creating fields as needed.
    fn resolve(&mut self, node: &JNode, scope: &Scope) -> Option<usize> {
        match node {
            JNode::Name(value) => {
                if let Some(&bound) = scope.params.get(value) {
                    return Some(bound);
                }
                if scope.element_param.as_deref() == Some(value.as_str()) {
                    return scope.element;
                }
                let base = scope.element.unwrap_or(self.root);
                Some(self.field(base, value))
            }
            JNode::Context => Some(scope.element.unwrap_or(self.root)),
            JNode::Root => Some(self.root),
            JNode::Parent { depth } => {
                // One level up is the enclosing element; deeper `%.%` bottoms
                // out at the input for inference purposes.
                if *depth <= 1 {
                    scope.parent
                } else {
                    Some(self.root)
                }
            }
            JNode::Dot { left, right } => {
                let JNode::Name(right_name) = right.as_ref() else {
                    return None;
                };
                let left_id = self.resolve(left, scope)?;
                Some(self.field(left_id, right_name))
            }
            JNode::Predicate { target, expr } => {
                let target_id = self.resolve(target, scope)?;
                self.nodes[target_id].is_array = true;
                let inner = Scope {
                    element: Some(target_id),
                    element_param: None,
                    parent: Some(scope.element.unwrap_or(self.root)),
                    params: HashMap::new(),
                };
                self.walk(expr, &inner, Leaf::Bool);
                Some(target_id)
            }
            // `arr#$i` / `arr@$v` — the binding decorates the array.
            JNode::Bind { target, .. } => self.resolve(target, scope),
            JNode::Sort { target, terms } => {
                let target_id = self.resolve(target, scope)?;
                self.nodes[target_id].is_array = true;
                let inner = Scope {
                    element: Some(target_id),
                    element_param: None,
                    parent: Some(scope.element.unwrap_or(self.root)),
                    params: HashMap::new(),
                };
                // Sort keys are comparable but not necessarily a fixed leaf.
                for (key, _) in terms {
                    self.walk(key, &inner, Leaf::Unknown);
                }
                Some(target_id)
            }
            _ => None,
        }
    }

    /// Bind a block's `$var`s to their value nodes.
    fn block_scope(&mut self, bindings: &[(String, JNode)], scope: &Scope) -> Scope {
        let mut params = scope.params.clone();
        for (name, value) in bindings {
            let inner = Scope {
                element: scope.element,
                element_param: scope.element_param.clone(),
                parent: scope.parent,
                params: params.clone(),
            };
            match self.resolve(value, &inner) {
                Some(t) => {
                    params.insert(name.clone(), t);
                }
                None => {
                    // Not a plain path: narrow the input paths it uses, bind
                    // the variable to a detached node.
                    self.walk(value, &inner, Leaf::Unknown);
                    let detached = self.make();
                    params.insert(name.clone(), detached);
                }
            }
        }
        Scope {
            element: scope.element,
            element_param: scope.element_param.clone(),
            parent: scope.parent,
            params,
        }
    }

    /// `arr.{ ... }` / `arr.( ...; { ... } )` per-element projection.
    /// Returns true when it handled the node.
    fn walk_projection(&mut self, node: &JNode, scope: &Scope) -> bool {
        let JNode::Dot { left, right } = node else {
            return false;
        };
        let obj_pairs: Option<&Vec<(String, JNode)>> = match right.as_ref() {
            JNode::Object { pairs } => Some(pairs),
            JNode::Block { result, .. } => match result.as_ref() {
                JNode::Object { pairs } => Some(pairs),
                _ => None,
            },
            _ => None,
        };
        let Some(pairs) = obj_pairs else {
            return false;
        };
        if let Some(target) = self.resolve(left, scope) {
            self.nodes[target].is_array = true;
            let mut inner = Scope {
                element: Some(target),
                element_param: None,
                parent: Some(scope.element.unwrap_or(self.root)),
                params: HashMap::new(),
            };
            // `arr#$i.( ... )`: bind the index var to a detached node.
            if let JNode::Bind {
                variable, op: '#', ..
            } = left.as_ref()
            {
                let mut params = scope.params.clone();
                let detached = self.make();
                params.insert(variable.clone(), detached);
                inner.params = params;
            }
            if let JNode::Block { bindings, .. } = right.as_ref() {
                inner = self.block_scope(bindings, &inner);
            }
            for (_, value) in pairs {
                self.walk(value, &inner, Leaf::Unknown);
            }
        }
        true
    }

    fn walk(&mut self, node: &JNode, scope: &Scope, expected: Leaf) {
        if let JNode::Block { bindings, result } = node {
            let inner = self.block_scope(bindings, scope);
            self.walk(result, &inner, expected);
            return;
        }
        if self.walk_projection(node, scope) {
            return;
        }
        match node {
            JNode::Name(_)
            | JNode::Context
            | JNode::Root
            | JNode::Parent { .. }
            | JNode::Dot { .. }
            | JNode::Predicate { .. }
            | JNode::Sort { .. } => {
                if let Some(t) = self.resolve(node, scope) {
                    self.set_leaf(t, expected);
                }
            }
            JNode::Call { name, args } => {
                let shape = arg_shape(name);
                let first = args.first();
                let rest = if args.is_empty() {
                    &args[0..0]
                } else {
                    &args[1..]
                };
                if let Some(first) = first {
                    if let Some((true, leaf)) = shape.filter(|_| matches!(first, JNode::Dot { .. }))
                    {
                        // `$sum(products.price)`: the CONTAINER is the array,
                        // the leaf a scalar.
                        if let JNode::Dot { left, .. } = first {
                            if let Some(container) = self.resolve(left, scope) {
                                self.nodes[container].is_array = true;
                            }
                        }
                        let leaf_node = self.resolve(first, scope);
                        if let (Some(id), Some(leaf)) = (leaf_node, leaf) {
                            self.set_leaf(id, leaf);
                        }
                    } else if let Some((array, leaf)) = shape {
                        match self.resolve(first, scope) {
                            Some(t) => {
                                if array {
                                    self.nodes[t].is_array = true;
                                }
                                if let Some(leaf) = leaf {
                                    self.set_leaf(t, leaf);
                                }
                            }
                            None => self.walk(first, scope, Leaf::Unknown),
                        }
                    } else if name == "filter" || name == "map" {
                        if let Some(t) = self.resolve(first, scope) {
                            self.nodes[t].is_array = true;
                            if let Some(JNode::Lambda { params, body }) = rest.first() {
                                // `$map` binds its param as an alias; `$filter`
                                // predicates use `$` only.
                                let mut scope_params = scope.params.clone();
                                if name == "map" {
                                    if let Some(p) = params.first() {
                                        scope_params.insert(p.clone(), t);
                                    }
                                }
                                let inner = Scope {
                                    element: Some(t),
                                    element_param: params.first().cloned(),
                                    parent: Some(scope.element.unwrap_or(self.root)),
                                    params: scope_params,
                                };
                                self.walk(body, &inner, Leaf::Unknown);
                            }
                        }
                    } else {
                        self.walk(first, scope, Leaf::Unknown);
                    }
                }
                for a in rest {
                    if !matches!(a, JNode::Lambda { .. }) {
                        self.walk(a, scope, Leaf::Unknown);
                    }
                }
            }
            JNode::Binary { op, left, right } => {
                if ["+", "-", "*", "/", "%"].contains(&op.as_str()) {
                    self.walk(left, scope, Leaf::Num);
                    self.walk(right, scope, Leaf::Num);
                    return;
                }
                if op == "&" {
                    self.walk(left, scope, Leaf::Str);
                    self.walk(right, scope, Leaf::Str);
                    return;
                }
                if op == "and" || op == "or" {
                    self.walk(left, scope, Leaf::Bool);
                    self.walk(right, scope, Leaf::Bool);
                    return;
                }
                if op == "in" {
                    // `v in list`: the right side is an array; the left one element.
                    match self.resolve(right, scope) {
                        Some(list) => self.nodes[list].is_array = true,
                        None => self.walk(right, scope, Leaf::Unknown),
                    }
                    self.walk(left, scope, Leaf::Unknown);
                    return;
                }
                // comparisons: a literal on one side types the other side
                let right_leaf = literal_leaf(right);
                let left_leaf = literal_leaf(left);
                self.walk(left, scope, right_leaf);
                self.walk(right, scope, left_leaf);
            }
            JNode::Ternary { cond, then, els } => {
                self.walk(cond, scope, Leaf::Bool);
                self.walk(then, scope, expected);
                self.walk(els, scope, expected);
            }
            JNode::Object { pairs } => {
                for (_, value) in pairs {
                    self.walk(value, scope, Leaf::Unknown);
                }
            }
            JNode::Array { items } => {
                for item in items {
                    self.walk(item, scope, Leaf::Unknown);
                }
            }
            JNode::Neg { operand } => {
                self.walk(operand, scope, Leaf::Num);
            }
            JNode::Lambda { body, .. } => {
                self.walk(body, scope, Leaf::Unknown);
            }
            _ => {}
        }
    }

    /// Top-level walk: `arr.{ ... }` projections and object values.
    fn walk_top(&mut self, node: &JNode, scope: &Scope) {
        if let JNode::Block { bindings, result } = node {
            let inner = self.block_scope(bindings, scope);
            self.walk_top(result, &inner);
            return;
        }
        if self.walk_projection(node, scope) {
            return;
        }
        if let JNode::Object { pairs } = node {
            for (_, value) in pairs {
                self.walk_top(value, scope);
            }
            return;
        }
        self.walk(node, scope, Leaf::Unknown);
    }

    fn render(&self, id: usize) -> String {
        let node = &self.nodes[id];
        let base = if !node.fields.is_empty() {
            let fields = node
                .fields
                .iter()
                .map(|(key, child)| {
                    let name = if is_ident(key) {
                        key.clone()
                    } else {
                        json_quote(key)
                    };
                    format!("{}: {}", name, self.render(*child))
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("{{ {} }}", fields)
        } else {
            node.leaf.name().to_string()
        };
        if node.is_array {
            format!("{}[]", base)
        } else {
            base
        }
    }
}

/// Infer the inline input type of a parsed JSONata expression.
pub fn infer_input_type(ast: &JNode) -> String {
    let mut inferrer = Inferrer {
        nodes: Vec::new(),
        root: 0,
    };
    let root = inferrer.make();
    inferrer.root = root;
    inferrer.walk_top(ast, &Scope::default());
    if inferrer.nodes[inferrer.root].fields.is_empty() {
        return "unknown".to_string();
    }
    inferrer.render(inferrer.root)
}
