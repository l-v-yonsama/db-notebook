import * as shiki from "shiki";
import { workspace } from "vscode";

export const createCodeHtmlString = async ({
  code,
  lang,
  themeName,
}: {
  code: string;
  lang: string;
  themeName?: string;
}): Promise<string> => {
  if (typeof code !== "string") {
    throw new Error(`code type(${typeof code}) must be string type. ` + code);
  }
  const theme = themeName !== undefined && themeName.length > 0 ? themeName : getThemeName();
  const highlighter = await shiki.getHighlighter({
    theme,
  });

  try {
    return highlighter.codeToHtml(code, { lang: getLanguage(lang) });
  } catch (e) {
    console.error(e);
    return highlighter.codeToHtml(code, { lang: "plaintext" });
  }
};

const getLanguage = (lang: string): string => {
  const language = shiki.BUNDLED_LANGUAGES.find(
    (x) =>
      x.id === lang.toLocaleLowerCase() ||
      (x.aliases && x.aliases.includes(lang.toLocaleLowerCase()))
  );
  return language?.id ?? "plaintext";
};

const getThemeName = (): string => {
  // get current vscode color UI theme name
  let colorTheme = workspace.getConfiguration("workbench").get<string>("colorTheme", "dark-plus"); // default to dark plus

  if (shiki.BUNDLED_THEMES.includes(colorTheme as shiki.Theme)) {
    return colorTheme;
  }

  // try normalized color theme name
  colorTheme = colorTheme.toLowerCase().replace("theme", "").replace(/\s+/g, "-");
  if (shiki.BUNDLED_THEMES.includes(colorTheme as shiki.Theme)) {
    return colorTheme;
  }

  return "css-variables";
};

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
