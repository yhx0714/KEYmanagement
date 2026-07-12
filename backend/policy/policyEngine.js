function tokenize(policy) {
  const tokens = [];
  const re = /\s*(\(|\)|AND\b|OR\b|[A-Za-z0-9_.-]+=[A-Za-z0-9_.-]+)\s*/gy;
  let index = 0;
  while (index < policy.length) {
    re.lastIndex = index;
    const match = re.exec(policy);
    if (!match) {
      throw new Error(`POLICY_INVALID: invalid token near "${policy.slice(index)}"`);
    }
    tokens.push(match[1]);
    index = re.lastIndex;
  }
  if (tokens.length === 0) {
    throw new Error("POLICY_INVALID: empty policy");
  }
  return tokens;
}

function parse(policy) {
  const tokens = tokenize(policy);
  let cursor = 0;

  function peek() {
    return tokens[cursor];
  }

  function consume(expected) {
    const token = tokens[cursor];
    if (expected && token !== expected) {
      throw new Error(`POLICY_INVALID: expected ${expected}, got ${token || "EOF"}`);
    }
    cursor += 1;
    return token;
  }

  function parsePrimary() {
    const token = peek();
    if (token === "(") {
      consume("(");
      const node = parseOr();
      consume(")");
      return node;
    }
    if (token && token.includes("=")) {
      consume();
      return { type: "attr", value: token };
    }
    throw new Error(`POLICY_INVALID: unexpected token ${token || "EOF"}`);
  }

  function parseAnd() {
    let node = parsePrimary();
    while (peek() === "AND") {
      consume("AND");
      node = { type: "and", left: node, right: parsePrimary() };
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (peek() === "OR") {
      consume("OR");
      node = { type: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  const ast = parseOr();
  if (cursor !== tokens.length) {
    throw new Error(`POLICY_INVALID: unexpected token ${peek()}`);
  }
  return ast;
}

function evaluateAst(ast, attributes) {
  const set = new Set(attributes);
  if (ast.type === "attr") {
    return set.has(ast.value);
  }
  if (ast.type === "and") {
    return evaluateAst(ast.left, attributes) && evaluateAst(ast.right, attributes);
  }
  if (ast.type === "or") {
    return evaluateAst(ast.left, attributes) || evaluateAst(ast.right, attributes);
  }
  return false;
}

function evaluate(policy, attributes) {
  return evaluateAst(parse(policy), attributes);
}

function validate(policy) {
  parse(policy);
  return true;
}

module.exports = {
  evaluate,
  parse,
  validate
};
