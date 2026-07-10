//! Lightweight jq input inference (port of `src/converter/jq/infer.ts`):
//! records root-relative field paths, narrows obvious usages. Tree nodes are
//! arena-allocated (indices) so scopes can alias the same node like the TS
//! object references do.

use super::parser::{QNode, UnaryOp};
use crate::util::{is_ident, json_quote};

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
    /// Insertion-ordered fields (like a JS Map).
    fields: Vec<(String, usize)>,
}

struct Arena {
    nodes: Vec<TNode>,
}

impl Arena {
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
}

fn literal_leaf(node: &QNode) -> Leaf {
    match node {
        QNode::Num(_) => Leaf::Num,
        QNode::Str(_) => Leaf::Str,
        QNode::Bool(_) => Leaf::Bool,
        _ => Leaf::Unknown,
    }
}

#[derive(Clone, Copy)]
struct Scope {
    current: usize,
}

struct Inferrer {
    arena: Arena,
    root: usize,
}

impl Inferrer {
    fn resolve(&mut self, node: &QNode, scope: Scope) -> Option<usize> {
        match node {
            QNode::Input => Some(scope.current),
            QNode::Field { target, name } => {
                let base = self.resolve(target, scope)?;
                Some(self.arena.field(base, name))
            }
            QNode::Index { target, .. } => self.resolve(target, scope),
            QNode::Iterate { target } => {
                let t = self.resolve(target, scope);
                if let Some(id) = t {
                    self.arena.nodes[id].is_array = true;
                }
                t
            }
            QNode::Pipe { left, right } => {
                let l = self.resolve(left, scope);
                match l {
                    None => {
                        self.walk(left, scope, Leaf::Unknown);
                        None
                    }
                    Some(l) => self.resolve(right, Scope { current: l }),
                }
            }
            _ => None,
        }
    }

    fn walk(&mut self, node: &QNode, scope: Scope, expected: Leaf) {
        match node {
            QNode::Input | QNode::Field { .. } | QNode::Index { .. } | QNode::Iterate { .. } => {
                if let Some(target) = self.resolve(node, scope) {
                    self.arena.set_leaf(target, expected);
                }
            }
            QNode::Pipe { left, right } => {
                let l = self.resolve(left, scope);
                match l {
                    Some(l) => self.walk(right, Scope { current: l }, expected),
                    None => {
                        self.walk(left, scope, Leaf::Unknown);
                        self.walk(right, scope, expected);
                    }
                }
            }
            QNode::Call { name, args } => {
                if name == "select" && !args.is_empty() {
                    self.arena.nodes[scope.current].is_array = true;
                    self.walk(&args[0], scope, Leaf::Bool);
                    return;
                }
                if name == "map" && !args.is_empty() {
                    self.arena.nodes[scope.current].is_array = true;
                    self.walk(&args[0], scope, Leaf::Unknown);
                    return;
                }
                if name == "sort_by" && !args.is_empty() {
                    self.arena.nodes[scope.current].is_array = true;
                    self.walk(&args[0], scope, Leaf::Unknown);
                    return;
                }
                if ["length", "join", "split", "contains"].contains(&name.as_str()) {
                    if name == "length" {
                        self.arena.nodes[scope.current].is_array = true;
                    } else {
                        self.arena.set_leaf(scope.current, Leaf::Str);
                    }
                }
                if ["tonumber", "floor", "ceil", "round", "sqrt", "add"].contains(&name.as_str()) {
                    self.arena.set_leaf(scope.current, Leaf::Num);
                }
                for arg in args {
                    self.walk(arg, scope, Leaf::Unknown);
                }
            }
            QNode::Binary { op, left, right } => {
                if op == "//" {
                    self.walk(left, scope, expected);
                    self.walk(right, scope, expected);
                    return;
                }
                if ["+", "-", "*", "/", "%"].contains(&op.as_str()) {
                    self.walk(left, scope, Leaf::Num);
                    self.walk(right, scope, Leaf::Num);
                    return;
                }
                if op == "and" || op == "or" {
                    self.walk(left, scope, Leaf::Bool);
                    self.walk(right, scope, Leaf::Bool);
                    return;
                }
                let right_leaf = literal_leaf(right);
                let left_leaf = literal_leaf(left);
                self.walk(left, scope, right_leaf);
                self.walk(right, scope, left_leaf);
            }
            QNode::Unary { op, expr } => {
                let expected = if *op == UnaryOp::Not {
                    Leaf::Bool
                } else {
                    Leaf::Num
                };
                self.walk(expr, scope, expected);
            }
            QNode::Object { pairs } => {
                for (_, value) in pairs {
                    self.walk(value, scope, Leaf::Unknown);
                }
            }
            QNode::Array { items } => {
                for item in items {
                    self.walk(item, scope, Leaf::Unknown);
                }
            }
            _ => {}
        }
    }

    fn render(&self, id: usize) -> String {
        let node = &self.arena.nodes[id];
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

pub fn infer_input_type(ast: &QNode) -> String {
    let mut arena = Arena { nodes: Vec::new() };
    let root = arena.make();
    let mut inferrer = Inferrer { arena, root };
    inferrer.walk(ast, Scope { current: root }, Leaf::Unknown);
    if inferrer.arena.nodes[inferrer.root].fields.is_empty() {
        return "unknown".to_string();
    }
    inferrer.render(inferrer.root)
}
