import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';

/**
 * Split a .sql file into individual statements. A `;` inside a single-quoted
 * string literal or a `--` line comment does not terminate a statement.
 * Line comments are stripped (line breaks preserved).
 */
export function splitSqlStatements(content: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inString) {
      current += char;
      if (char === "'") {
        if (content[i + 1] === "'") {
          // Escaped quote ('') inside a string literal.
          current += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }

    if (char === '-' && content[i + 1] === '-') {
      while (i < content.length && content[i] !== '\n') i += 1;
      current += '\n';
      continue;
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last.length > 0) statements.push(last);

  return statements;
}

export async function runSqlFile(client: Client, fileUrl: URL): Promise<void> {
  const content = await readFile(fileUrl, 'utf8');
  for (const statement of splitSqlStatements(content)) {
    await client.query(statement);
  }
}
