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
    'file-name-camel-case': {
      create(context) {
        const name = context.filename.split(/[\\/]/).pop().split('.')[0];
        return {
          'Program:exit'(program) {
            if (/^_?[a-zA-Z][a-zA-Z0-9]*$/.test(name)) return;
            context.report({ node: program, loc: { line: 1, column: 0 }, message: `File names are camelCase (or PascalCase for a component), not "${name}": rename it to ${name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())}.` });
          },
        };
      },
    },
    'service-class': {
      create(context) {
        const name = context.filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        return {
          'Program:exit'(program) {
            const loc = { line: 1, column: 0 };
            if (!/^[a-z][A-Za-z0-9]*Service$/.test(name)) {
              context.report({ node: program, loc, message: `A file under services/ is named <name>Service.ts (camelCase), not "${name}".` });
              return;
            }
            const className = name.charAt(0).toUpperCase() + name.slice(1);
            let hasClass = false;
            for (const node of program.body) {
              if (!node.type.startsWith('Export')) continue;
              const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : undefined;
              if (declaration?.type === 'ClassDeclaration' && declaration.id?.name === className) {
                hasClass = true;
                continue;
              }
              if (declaration?.type === 'TSTypeAliasDeclaration' || declaration?.type === 'TSInterfaceDeclaration') continue;
              if (!declaration && node.exportKind === 'type') continue;
              context.report({ node, message: `${name}.ts exports ${className} and types or interfaces, nothing else.` });
            }
            if (!hasClass) {
              context.report({ node: program, loc, message: `${name}.ts must export a class named ${className}.` });
            }
          },
        };
      },
    },
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
