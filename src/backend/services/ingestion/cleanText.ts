export function cleanPageText(raw: string) {
  return raw
    .replace(/-\s*\n\s*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function normalizeForChunking(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/\n(?=\S)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
