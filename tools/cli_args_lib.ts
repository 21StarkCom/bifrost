/** Shared argv tokenizer for operational CLIs. Never reads config or runs work.
 * Values are consumed by declared arity, not by guessing from the next token.
 * `--` ends our grammar; callers decide whether a literal/child tail is legal.
 */
export interface CliShape {
  values?: readonly string[];
  switches?: readonly string[];
  positionals?: number;
  equals?: boolean;
}

export function cliValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || /^--|^-h$/.test(value)) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCli(argv: string[], shape: CliShape) {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let help = false;
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!literal && token === "--") { literal = true; continue; }
    if (!literal && ["help", "--help", "-h"].includes(token)) { help = true; continue; }
    if (!literal && token.startsWith("-")) {
      const eq = token.indexOf("=");
      const name = eq < 0 ? token : token.slice(0, eq);
      const key = name.replace(/^--?/, "");
      if (shape.switches?.includes(name)) {
        if (eq >= 0) throw new Error(`${name} takes no value`);
        flags.set(key, true);
      } else if (shape.values?.includes(name)) {
        if (eq >= 0 && !shape.equals) throw new Error(`unsupported argument: ${token}; use ${name} VALUE`);
        const value = eq < 0 ? argv[++i] : token.slice(eq + 1);
        if (value === undefined || (eq < 0 && /^--|^-h$/.test(value))) {
          throw new Error(`${name} requires a value; use ${name}=VALUE for a leading-dash literal`);
        }
        flags.set(key, value);
      } else throw new Error(`unknown argument: ${token}`);
    } else positionals.push(token);
  }
  if (positionals.length > (shape.positionals ?? 0)) {
    throw new Error(`unexpected positional argument: ${positionals[shape.positionals ?? 0]}`);
  }
  return { flags, positionals, help };
}

/** Arity-aware help check for CLIs whose existing parser owns validation.
 * Unknown arguments remain that parser's responsibility. No scan of stdin,
 * free text, an explicit flag value, or the literal tail after `--`.
 */
export function hasCliHelp(argv: string[], valueFlags: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") return false;
    if (["help", "--help", "-h"].includes(token)) return true;
    if (valueFlags.includes(token)) i++;
  }
  return false;
}
