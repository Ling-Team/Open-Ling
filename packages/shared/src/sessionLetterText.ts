export function normalizeSessionLetterMarkdown(markdown: string) {
  return markdown.replace(/\\r\\n|\\n|\\r/g, "\n");
}

export function isSessionLetterSalutation(paragraph: string) {
  const text = paragraph.trim();
  return /^(?:亲爱的)?(?:你|[\p{L}\p{N}_·・\- ]{1,30})[：:]$/u.test(text)
    || /^给你[：:]$/u.test(text)
    || /^Dear\s+[^\n,]{1,40},$/iu.test(text);
}

function isLetterOpening(line: string, displayName: string | undefined) {
  const text = line.trim().replace(/^#+\s*/, "").replace(/\*\*|__/g, "").trim();
  return isSessionLetterSalutation(text)
    || (!!displayName && (text === `${displayName},` || text === `${displayName}：` || text === `${displayName}:`))
    || /^(?:(?:用户|来访者)(?:的)?(?:称呼|姓名)|称呼)\s*[：:][^\n]*$/u.test(text)
    || /^(?:Client's preferred form of address|Preferred name|User name)\s*:[^\n]*$/iu.test(text);
}

export function formatSessionLetterMarkdown(
  markdown: string,
  clientDisplayName: string | undefined,
  locale: "zh-CN" | "en-US"
) {
  const displayName = clientDisplayName?.trim();
  const lines = normalizeSessionLetterMarkdown(markdown).replace(/\r\n?/g, "\n").trim().split("\n");
  // Only clean the opening: labels quoted later in the letter are part of its content.
  // Iterate because saved letters may already contain both an added name and a leaked label.
  while (lines.length && (!lines[0].trim() || isLetterOpening(lines[0], displayName))) lines.shift();
  const paragraphs = lines.join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  if (displayName) paragraphs.unshift(locale === "en-US" ? `${displayName},` : `${displayName}：`);
  return paragraphs.join("\n\n");
}

export function splitSessionLetterParagraphs(
  markdown: string,
  clientDisplayName: string | undefined,
  locale: "zh-CN" | "en-US"
) {
  return formatSessionLetterMarkdown(markdown, clientDisplayName, locale).split(/\n{2,}/).filter(Boolean);
}
