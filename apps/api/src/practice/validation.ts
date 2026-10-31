import ts from 'typescript';
import { z } from 'zod';

export type SyntaxFinding = { code: number; line: number; column: number; message: string };

// The compiler receives exactly one in-memory file. It does not resolve imports,
// load configuration, emit files, or execute any part of the submitted text.
export function checkSyntax(code: string, language: 'javascript' | 'typescript'): SyntaxFinding[] {
  const filename = language === 'javascript' ? 'submission.js' : 'submission.ts';
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, noEmit: true, allowJs: true };
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true,
    language === 'javascript' ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: name => name === filename ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: name => name === filename,
    readFile: name => name === filename ? code : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram([filename], options, host);
  return program.getSyntacticDiagnostics(source).slice(0, 100).map(diagnostic => {
    const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return { code: diagnostic.code, line: position.line + 1, column: position.character + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
  });
}

const testCaseSchema = z.object({
  category: z.enum(['normal', 'boundary', 'exception']),
  title: z.string().trim().min(1).max(200),
  preconditions: z.string().trim().max(2000),
  steps: z.string().trim().min(1).max(4000),
  expected: z.string().trim().min(1).max(3000),
  requirementIds: z.array(z.string().regex(/^REQ-[a-f0-9]{16}$/)).max(200).optional(),
}).strict();
const generatedSchema = z.object({ cases: z.array(testCaseSchema).min(3).max(30) }).strict();
export type GeneratedCase = z.infer<typeof testCaseSchema>;
export function parseGeneratedCases(raw: string): GeneratedCase[] | null {
  try {
    const result = generatedSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    const categories = new Set(result.data.cases.map(item => item.category));
    return categories.size === 3 ? result.data.cases : null;
  } catch { return null; }
}
