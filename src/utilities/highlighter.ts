import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";

// "text"/"plaintext" and other non-highlightable codes are expected inputs,
// not errors, so silence loadLanguages' console warning for unknown ids.
loadLanguages.silent = true;

// Maps our short language codes (mostly file extensions / mime-derived hints,
// see multi-platform-database-drivers' parseContentType) to Prism's component ids.
// Only entries where the two differ need to be listed; unlisted codes are
// tried as-is against Prism's own component/alias ids.
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  cs: "csharp",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  rb: "ruby",
  rs: "rust",
  py: "python",
  md: "markdown",
  vb: "visual-basic",
  ps: "powershell",
  ps1: "powershell",
  make: "makefile",
  html: "markup",
  xml: "markup",
  gql: "graphql",
  spl: "splunk-spl",
  tex: "latex",
  bat: "batch",
  coffee: "coffeescript",
};

export const createCodeHtmlString = async ({
  code,
  lang,
}: {
  code: string;
  lang: string;
}): Promise<string> => {
  if (typeof code !== "string") {
    throw new Error(`code type(${typeof code}) must be string type. ` + code);
  }

  const langId = resolveLanguageId(lang);
  if (langId) {
    try {
      const html = Prism.highlight(code, Prism.languages[langId], langId);
      return `<pre class="code-highlight"><code class="language-${langId}">${html}</code></pre>`;
    } catch (e) {
      console.error(e);
    }
  }
  return `<pre class="code-highlight"><code>${escapeHtml(code)}</code></pre>`;
};

function resolveLanguageId(lang: string): string | undefined {
  const id = LANG_ALIASES[lang?.toLowerCase()] ?? lang?.toLowerCase();
  if (!id) {
    return undefined;
  }
  if (!Prism.languages[id]) {
    loadLanguages([id]);
  }
  return Prism.languages[id] ? id : undefined;
}

const escapeHtml = (s: string): string => {
  if (typeof s !== "string") {
    return s;
  }
  return s
    .replace(/&/g, "&amp;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/`/g, "&#x60;");
};
