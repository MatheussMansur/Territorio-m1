// Barra um commit que leva chave, token ou senha. Roda como hook de pre-commit (lê o que está
// no stage, não a cópia no disco) ou com --all sobre todo arquivo que o git rastrearia.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  ["JWT (ex.: chave do Supabase)", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ["Chave secreta do Supabase", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["Chave privada", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Token da Meta (WhatsApp)", /\bEAA[A-Za-z0-9]{40,}/],
  ["Chave da AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["Token do GitHub", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Chave de API genérica", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["Senha ou segredo atribuído", /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ["Senha ou segredo em JSON", /"(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)"\s*:\s*"[^"\s]{8,}"/i],
  ["Endereço com senha (ex.: banco do Supabase)", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s@"'/]{6,}@[^\s"']+/i],
  ["Segredo em variável de ambiente", /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*([^\s#"']\S{7,})/],
];
// um valor que é claramente só um exemplo no .env.example
const PLACEHOLDER = /^(<|\$\{|change|troque|example|exemplo|x{4,}|\*{4,})/i;
const SKIP = /(^|\/)(package-lock\.json|.*\.(woff2?|png|jpe?g|webp|avif|gif|ico|pdf|glb))$/i;

const all = process.argv.includes("--all");
// -z: nomes com acento ou espaço vêm como são, sem aspas
const files = execFileSync(
  "git",
  all ? ["ls-files", "-z", "--cached", "--others", "--exclude-standard"] : ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((f) => f && !SKIP.test(f));

function read(file) {
  if (!all) return execFileSync("git", ["show", `:${file}`], { encoding: "utf8", maxBuffer: 16_000_000 });
  if (statSync(file).size > 2_000_000) return "";
  return readFileSync(file, "utf8");
}

const hits = [];
const unreadable = [];
for (const file of files) {
  let text;
  try {
    text = read(file);
  } catch (error) {
    if (all && error.code === "ENOENT") continue; // rastreado, mas apagado no disco
    unreadable.push(file);
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const [label, re] of PATTERNS) {
      const match = line.match(re);
      if (match && !(match[1] && PLACEHOLDER.test(match[1]))) hits.push(`${file}:${i + 1}  ${label}`);
    }
  });
}

if (hits.length || unreadable.length) {
  if (hits.length) console.error("Possível segredo encontrado. O commit foi bloqueado:\n  " + hits.join("\n  "));
  if (unreadable.length) console.error("Não deu para ler, então não dá para garantir:\n  " + unreadable.join("\n  "));
  console.error("Segredos vão no .env do servidor, nunca no repositório.");
  process.exit(1);
}
console.log(`check-secrets: ${files.length} arquivos, nenhum segredo.`);
