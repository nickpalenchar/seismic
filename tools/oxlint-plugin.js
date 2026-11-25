const documentableExpressions = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
]);

function hasDescription(comment) {
  if (comment.type !== 'Block' || !comment.value.startsWith('*')) return false;
  const lines = comment.value.slice(1).split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*\s?/, '').trim());
  const firstLine = lines.find(Boolean);
  return Boolean(firstLine && !firstLine.startsWith('@')
    && !lines.some((line) => /^@(?:file|fileoverview|overview|module|packageDocumentation)\b/.test(line)));
}

export default {
  meta: { name: 'seismic' },
  rules: {
    'documentation-comments': {
      meta: { fixable: 'code' },
      create(context) {
        const source = context.sourceCode;
        const allowed = new Set();

        function allowDocumentation(node) {
          const target = ['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(node.parent?.type)
            ? node.parent
            : node;
          const comment = source.getCommentsBefore(target).at(-1);
          if (comment && target.loc.start.line - comment.loc.end.line <= 1 && hasDescription(comment)) {
            allowed.add(comment.range[0]);
          }
        }

        return {
          FunctionDeclaration: allowDocumentation,
          TSDeclareFunction: allowDocumentation,
          ClassDeclaration: allowDocumentation,
          MethodDefinition: allowDocumentation,
          Property(node) {
            if (documentableExpressions.has(node.value.type)) allowDocumentation(node);
          },
          PropertyDefinition(node) {
            if (documentableExpressions.has(node.value?.type)) allowDocumentation(node);
          },
          VariableDeclaration(node) {
            const [declaration] = node.declarations;
            if (node.declarations.length === 1 && documentableExpressions.has(declaration.init?.type)) {
              allowDocumentation(node);
            }
          },
          ExportDefaultDeclaration(node) {
            if (documentableExpressions.has(node.declaration.type)) allowDocumentation(node);
          },
          'Program:exit'() {
            for (const comment of source.getAllComments()) {
              if (allowed.has(comment.range[0])) continue;
              context.report({
                loc: comment.loc,
                message: 'Use comments only for JSDoc descriptions of functions, classes, or methods.',
                fix(fixer) {
                  const [start, end] = comment.range;
                  const text = source.text.slice(start, end);
                  const lineBreaks = text.match(/\r\n|[\n\r\u2028\u2029]/g);
                  const betweenTokens = /\S/.test(source.text.charAt(start - 1))
                    && /\S/.test(source.text.charAt(end));
                  return fixer.replaceTextRange(comment.range, lineBreaks?.join('') ?? (betweenTokens ? ' ' : ''));
                },
              });
            }
          },
        };
      },
    },
  },
};
