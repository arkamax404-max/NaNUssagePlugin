const CANVAS_SIZE = 196;
const TEXT_MAX_WIDTH = 168;
const TEXT_ANCHOR_X = 98;

const BACKGROUNDS = Object.freeze({
  1: "#0d1117",
  2: "#3b2600",
  3: "#341216",
});

const HEADER_TEXT = "USED";
const HEADER_Y = 26;
const HEADER_SIZE = 15;
const HEADER_FILL = "#8b949e";

const ROW_LABEL_Y = Object.freeze([64, 108, 152]);
const ROW_LABEL_SIZE = 20;
const ROW_LABEL_X = 14;
const ROW_LABEL_FILL = "#c9d1d9";
const ROW_VALUE_X = 182;
const ROW_VALUE_SIZE = 22;
const ROW_VALUE_FILL = "#ffffff";

const BAR_OFFSET = 12;
const BAR_HEIGHT = 7;
const BAR_WIDTH = 113;
const BAR_TRACK = "#30363d";
const BAR_FILL = "#58a6ff";

const FOOTER_Y = 188;
const FOOTER_SIZE = 15;
const FOOTER_FILL = "#8b949e";

const MESSAGE_Y = 101;
const MESSAGE_SIZE = 34;
const MESSAGE_FILL = "#f0a0a8";

// The value sits on the bar's line, so the room left of ROW_VALUE_X after the
// bar and a 12px breathing gap is its hard budget.
const VALUE_MAX_WIDTH = ROW_VALUE_X - BAR_WIDTH - 12;

const FONT_FAMILY = "Arial, sans-serif";
const FONT_WEIGHT = 700;
const ARIAL_BOLD_ADVANCES = Object.freeze({
  " ": 278,
  "/": 278,
  "%": 889,
  "+": 584,
  ".": 278,
  ",": 278,
  "-": 333,
  ":": 333,
  "(": 333,
  ")": 333,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  a: 556,
  b: 611,
  c: 556,
  d: 611,
  e: 556,
  f: 333,
  g: 611,
  h: 611,
  i: 278,
  j: 278,
  k: 556,
  l: 278,
  m: 889,
  n: 611,
  o: 611,
  p: 611,
  q: 611,
  r: 389,
  s: 556,
  t: 333,
  u: 611,
  v: 556,
  w: 778,
  x: 556,
  y: 556,
  z: 500,
});
const FALLBACK_ADVANCE = 1000;

function createUsageImage(view) {
  if (!view || !Object.hasOwn(BACKGROUNDS, view.state)) return null;
  try {
    return toDataUri(buildSvg(view));
  } catch {
    return null;
  }
}

function buildSvg(view) {
  const rows = (Array.isArray(view.rows) ? view.rows : [])
    .filter((row) => row && typeof row === "object")
    .slice(0, ROW_LABEL_Y.length);
  const body = [
    rows.length > 0 ? createHeader() : "",
    rows.map((row, index) => createRow(row, index)).join(""),
    rows.length === 0 ? createMessage(view.message) : "",
    createFooter(view.footer),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}"><defs><clipPath id="key-shape"><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" rx="12"/></clipPath></defs><g clip-path="url(#key-shape)"><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" rx="12" fill="${BACKGROUNDS[view.state]}"/>${body}</g></svg>`;
}

function createHeader() {
  const size = fitFontSize(HEADER_TEXT, HEADER_SIZE);
  return `<text data-header="1" x="${TEXT_ANCHOR_X}" y="${HEADER_Y}" fill="${HEADER_FILL}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${FONT_WEIGHT}" text-anchor="middle">${escapeXml(HEADER_TEXT)}</text>`;
}

function createRow(row, index) {
  const labelY = ROW_LABEL_Y[index];
  const barY = labelY + BAR_OFFSET;
  const labelSize = Math.min(ROW_LABEL_SIZE, fitFontSize(String(row.label), ROW_LABEL_SIZE, TEXT_MAX_WIDTH));
  const valueText = `${String(row.percent)}%`;
  const valueSize = Math.min(ROW_VALUE_SIZE, fitFontSize(valueText, ROW_VALUE_SIZE, VALUE_MAX_WIDTH));
  const label = `<text data-row-label="${index}" x="${ROW_LABEL_X}" y="${labelY}" fill="${ROW_LABEL_FILL}" font-family="${FONT_FAMILY}" font-size="${labelSize}" font-weight="${FONT_WEIGHT}" text-anchor="start">${escapeXml(String(row.label))}</text>`;
  const track = `<rect data-row-bar-track="${index}" x="0" y="${barY}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" fill="${BAR_TRACK}"/>`;
  const value = `<text data-row-value="${index}" x="${ROW_VALUE_X}" y="${barY + BAR_HEIGHT}" fill="${ROW_VALUE_FILL}" font-family="${FONT_FAMILY}" font-size="${valueSize}" font-weight="${FONT_WEIGHT}" text-anchor="end">${escapeXml(valueText)}</text>`;
  return `${label}${track}${createBarFill(row.consumedPercent, index, barY)}${value}`;
}

function createBarFill(consumedPercent, index, y) {
  if (!Number.isFinite(consumedPercent)) return "";
  const consumed = Math.max(0, Math.min(100, consumedPercent));
  const width = Number((BAR_WIDTH * consumed / 100).toFixed(3));
  return `<rect data-row-bar-fill="${index}" x="0" y="${y}" width="${width}" height="${BAR_HEIGHT}" fill="${BAR_FILL}"/>`;
}

function createMessage(message) {
  if (typeof message !== "string" || message === "") return "";
  const size = fitFontSize(message, MESSAGE_SIZE);
  return `<text data-message="1" x="${TEXT_ANCHOR_X}" y="${MESSAGE_Y}" fill="${MESSAGE_FILL}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${FONT_WEIGHT}" text-anchor="middle">${escapeXml(message)}</text>`;
}

function createFooter(footer) {
  if (typeof footer !== "string" || footer === "") return "";
  const size = fitFontSize(footer, FOOTER_SIZE);
  return `<text data-footer="1" x="${TEXT_ANCHOR_X}" y="${FOOTER_Y}" fill="${FOOTER_FILL}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${FONT_WEIGHT}" text-anchor="middle">${escapeXml(footer)}</text>`;
}

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function estimateTextWidth(text, fontSize) {
  if (!Number.isFinite(fontSize)) return 0;
  let advance = 0;
  for (const character of text) {
    advance += ARIAL_BOLD_ADVANCES[character] ?? FALLBACK_ADVANCE;
  }
  return advance * fontSize / 1000;
}

function fitFontSize(text, fontSize, maxWidth = TEXT_MAX_WIDTH) {
  if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(maxWidth) || maxWidth <= 0)
    return fontSize;
  const width = estimateTextWidth(text, fontSize);
  if (width <= maxWidth) return fontSize;
  const fitted = fontSize * maxWidth / width;
  return Math.floor(fitted * 100) / 100;
}

module.exports = {
  BACKGROUNDS,
  BAR_HEIGHT,
  BAR_OFFSET,
  BAR_WIDTH,
  CANVAS_SIZE,
  createUsageImage,
  escapeXml,
  estimateTextWidth,
  fitFontSize,
  FOOTER_Y,
  HEADER_TEXT,
  MESSAGE_Y,
  ROW_LABEL_SIZE,
  ROW_LABEL_X,
  ROW_LABEL_Y,
  ROW_VALUE_SIZE,
  ROW_VALUE_X,
  TEXT_MAX_WIDTH,
};
