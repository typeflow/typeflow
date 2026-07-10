//! Typeflow AST — the subset needed to parse and canonically format a
//! mapping file (port of `src/core/ast.ts` minus checker-only fields).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub enum LitValue {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Lit {
        value: LitValue,
        span: Span,
    },
    Ident {
        name: String,
        span: Span,
    },
    Member {
        object: Box<Expr>,
        name: String,
        optional: bool,
        span: Span,
    },
    /// `expr[inner]` before semantic analysis (the formatter prints it as-is).
    Bracket {
        object: Box<Expr>,
        inner: Box<Expr>,
        span: Span,
    },
    Sort {
        object: Box<Expr>,
        terms: Vec<SortTerm>,
        span: Span,
    },
    Project {
        object: Box<Expr>,
        binder: Option<String>,
        index_binder: Option<String>,
        body: ObjectExpr,
        span: Span,
    },
    Unary {
        op: char, // '!' or '-'
        operand: Box<Expr>,
        span: Span,
    },
    Binary {
        op: String,
        left: Box<Expr>,
        right: Box<Expr>,
        span: Span,
    },
    Cond {
        cond: Box<Expr>,
        then: Box<Expr>,
        els: Box<Expr>,
        span: Span,
    },
    Call {
        name: String,
        args: Vec<Expr>,
        span: Span,
    },
    Object(ObjectExpr),
    Array {
        elements: Vec<Expr>,
        span: Span,
    },
}

impl Expr {
    pub fn span(&self) -> Span {
        match self {
            Expr::Lit { span, .. }
            | Expr::Ident { span, .. }
            | Expr::Member { span, .. }
            | Expr::Bracket { span, .. }
            | Expr::Sort { span, .. }
            | Expr::Project { span, .. }
            | Expr::Unary { span, .. }
            | Expr::Binary { span, .. }
            | Expr::Cond { span, .. }
            | Expr::Call { span, .. }
            | Expr::Array { span, .. } => *span,
            Expr::Object(o) => o.span,
        }
    }

    pub fn set_span(&mut self, new: Span) {
        match self {
            Expr::Lit { span, .. }
            | Expr::Ident { span, .. }
            | Expr::Member { span, .. }
            | Expr::Bracket { span, .. }
            | Expr::Sort { span, .. }
            | Expr::Project { span, .. }
            | Expr::Unary { span, .. }
            | Expr::Binary { span, .. }
            | Expr::Cond { span, .. }
            | Expr::Call { span, .. }
            | Expr::Array { span, .. } => *span = new,
            Expr::Object(o) => o.span = new,
        }
    }
}

#[derive(Clone, Debug)]
pub struct SortTerm {
    pub key: Expr,
    pub descending: bool,
}

#[derive(Clone, Debug)]
pub struct ObjectProp {
    pub name: String,
    pub value: Expr,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct LetBinding {
    pub name: String,
    pub value: Expr,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct ObjectExpr {
    pub props: Vec<ObjectProp>,
    pub lets: Vec<LetBinding>,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum TypeNode {
    Prim {
        name: String,
        span: Span,
    },
    Lit {
        value: LitValue,
        span: Span,
    },
    Array {
        element: Box<TypeNode>,
        span: Span,
    },
    Object {
        fields: Vec<TypeFieldNode>,
        span: Span,
    },
    Union {
        types: Vec<TypeNode>,
        span: Span,
    },
}

impl TypeNode {
    pub fn span(&self) -> Span {
        match self {
            TypeNode::Prim { span, .. }
            | TypeNode::Lit { span, .. }
            | TypeNode::Array { span, .. }
            | TypeNode::Object { span, .. }
            | TypeNode::Union { span, .. } => *span,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TypeFieldNode {
    pub name: String,
    pub optional: bool,
    pub type_: TypeNode,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct UseParam {
    pub name: String,
    pub optional: bool,
    pub type_: TypeNode,
}

#[derive(Clone, Debug)]
pub struct InputDecl {
    pub name: String,
    /// `input user: User from "./types"`
    pub type_ref: Option<(String, String)>, // (typeName, from)
    /// `input user: { ... }`
    pub inline_type: Option<TypeNode>,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct UseDecl {
    pub name: String,
    pub params: Vec<UseParam>,
    pub return_type: TypeNode,
    pub from: String,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct FnDecl {
    pub name: String,
    pub params: Vec<UseParam>,
    pub return_type: Option<TypeNode>,
    pub body: Expr,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct MappingFile {
    pub input: Option<InputDecl>,
    pub uses: Vec<UseDecl>,
    pub fns: Vec<FnDecl>,
    pub map: ObjectExpr,
}
