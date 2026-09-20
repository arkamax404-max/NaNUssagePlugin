const assert = require("node:assert/strict");
const test = require("node:test");
const { MODEL_LABELS } = require("../src/plugin/presentation.js");
const {
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
} = require("../src/plugin/usage-image-renderer.js");

const DATA_URI_PREFIX = "data:image/svg+xml;base64,";
const VALUE_MAX_WIDTH = ROW_VALUE_X - BAR_WIDTH - 12;

// The renderer keeps HEADER_SIZE internal (it is not part of the frozen export
// list), so the test pins the design size here on purpose: the width budget has
// to be asserted at the size the header is drawn at, not at whatever size
// auto-fit happened to produce, or a longer header would shrink silently.
const HEADER_SIZE = 22;
// Glyph envelope ratios from the design document's vertical fit section: a
// bold Arial glyph reaches 0.75em above and 0.22em below its baseline.
const ASCENT_RATIO = 0.75;
const DESCENT_RATIO = 0.22;
const ELEMENT_PATTERN = /<(text|rect)\b([^>]*?)(?:\/>|>([^<]*)<\/text>)/g;

const XML_NAME = "[A-Za-z_][A-Za-z0-9_.:-]*";
const OPENING_TAG_PATTERN = new RegExp(`^(${XML_NAME})`);
const CLOSING_TAG_PATTERN = new RegExp(`^/\\s*(${XML_NAME})\\s*$`);
const ATTRIBUTE_PATTERN = new RegExp(`\\s+(${XML_NAME})="([^"]*)"`, "y");
const ENTITY_PATTERN = /^&(amp|lt|gt|quot|apos);/;
const ENTITY_MAX_LENGTH = "&quot;".length;

function findBareAmpersand(svg) {
  let index = svg.indexOf("&");
  while (index !== -1) {
    if (!ENTITY_PATTERN.test(svg.slice(index, index + ENTITY_MAX_LENGTH))) return index;
    index = svg.indexOf("&", index + 1);
  }
  return -1;
}

// The host decodes the image/svg+xml data uri with an XML parser, so the svg must
// be well-formed xml: a valueless attribute, an unclosed tag or a raw "&" is a
// fatal parse error that silently blanks the key. Node has no xml parser in its
// standard library, so this walks the tags with a stack instead of a regex.
function assertWellFormedSvg(svg) {
  assert.equal(typeof svg, "string", "the checker needs an svg string");
  assert.equal(svg.startsWith("<"), true, "an svg document must start with a tag");
  assert.equal(svg.endsWith(">"), true, "an svg document must end with a tag");
  const bareAmpersand = findBareAmpersand(svg);
  assert.equal(bareAmpersand === -1, true, `unescaped & at offset ${bareAmpersand}`);

  const stack = [];
  let roots = 0;
  let cursor = 0;
  while (cursor < svg.length) {
    const open = svg.indexOf("<", cursor);
    if (open === -1) break;
    const close = svg.indexOf(">", open);
    assert.notEqual(close, -1, `unterminated tag at offset ${open}`);
    const inner = svg.slice(open + 1, close);

    if (inner.startsWith("/")) {
      const name = CLOSING_TAG_PATTERN.exec(inner)?.[1];
      assert.notEqual(name, undefined, `malformed closing tag <${inner}>`);
      assert.equal(stack.length > 0, true, `closing </${name}> without an open tag`);
      assert.equal(stack[stack.length - 1], name, `closing </${name}> does not match <${stack[stack.length - 1]}>`);
      stack.pop();
    } else {
      const selfClosing = inner.endsWith("/");
      const body = selfClosing ? inner.slice(0, -1) : inner;
      const name = OPENING_TAG_PATTERN.exec(body)?.[1];
      assert.notEqual(name, undefined, `malformed opening tag <${inner}>`);
      const attributes = body.slice(name.length);
      let offset = 0;
      while (offset < attributes.length) {
        ATTRIBUTE_PATTERN.lastIndex = offset;
        const attribute = ATTRIBUTE_PATTERN.exec(attributes);
        assert.notEqual(attribute, null, `attribute ${JSON.stringify(attributes.slice(offset))} of <${name}> is not name="value"`);
        assert.equal(attribute[2].includes("<"), false, `raw < in the value of ${attribute[1]}`);
        offset = ATTRIBUTE_PATTERN.lastIndex;
      }
      if (stack.length === 0) roots += 1;
      if (!selfClosing) stack.push(name);
    }
    cursor = close + 1;
  }
  assert.equal(stack.length, 0, `unclosed <${stack.join(">, <")}>`);
  assert.equal(roots, 1, `expected exactly one root element, found ${roots}`);
}

function decode(image) {
  assert.equal(typeof image, "string");
  assert.equal(image.startsWith(DATA_URI_PREFIX), true);
  const svg = Buffer.from(image.slice(DATA_URI_PREFIX.length), "base64").toString("utf8");
  assertWellFormedSvg(svg);
  return svg;
}

function elements(svg) {
  return [...svg.matchAll(ELEMENT_PATTERN)].map((match) => {
    const attributes = {};
    for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      attributes[attribute[1]] = attribute[2] ?? "";
    }
    return { tag: match[1], attributes, text: match[3] ?? "" };
  });
}

function byHook(svg, hook, value) {
  return elements(svg).filter((element) => Object.hasOwn(element.attributes, hook)
    && (value === undefined || element.attributes[hook] === String(value)));
}

function single(svg, hook, value) {
  const found = byHook(svg, hook, value);
  assert.equal(found.length, 1, `expected one ${hook}="${value}" element`);
  return found[0];
}

function row(modelId, label, percent, consumedPercent, remainingPercent) {
  return { modelId, label, percent, consumedPercent, remainingPercent };
}

function usageView(rows, extra = {}) {
  return { state: 1, rows, message: null, footer: "", ...extra };
}

const THREE_ROWS = [
  row("deepseek-v4-flash", "deepseek v4", 8, 8.1, 91.9),
  row("glm5.3-flash", "glm5.3 flash", 1, 1.3, 98.7),
  row("mimo-v2.5", "mimo 2.5", 1, 1.3, 98.7),
];

test("keeps the frozen renderer constants", () => {
  assert.equal(CANVAS_SIZE, 196);
  assert.equal(TEXT_MAX_WIDTH, 168);
  assert.equal(HEADER_TEXT, "NaN - USED");
  assert.deepEqual(ROW_LABEL_Y, [64, 108, 152]);
  assert.equal(ROW_LABEL_SIZE, 20);
  assert.equal(ROW_LABEL_X, 14);
  assert.equal(ROW_VALUE_X, 182);
  assert.equal(ROW_VALUE_SIZE, 22);
  assert.equal(BAR_OFFSET, 12);
  assert.equal(BAR_HEIGHT, 7);
  assert.equal(BAR_WIDTH, 113);
  assert.equal(FOOTER_Y, 188);
  assert.equal(MESSAGE_Y, 101);
  assert.deepEqual(BACKGROUNDS, { 1: "#0d1117", 2: "#3b2600", 3: "#341216" });
});

test("keeps a twelve pixel clearance between the widest value and the full bar", () => {
  const baseline = ROW_LABEL_Y.map((y) => y + BAR_OFFSET + BAR_HEIGHT);
  assert.deepEqual(baseline, [83, 127, 171]);
  const widest = estimateTextWidth("100%", ROW_VALUE_SIZE);
  assert.ok(Math.abs(widest - 56.254) < 1e-9);
  assert.ok(BAR_WIDTH + widest <= ROW_VALUE_X - 12);
  assert.equal(VALUE_MAX_WIDTH, 57);
});

test("returns null for a missing view or a state without a background", () => {
  for (const view of [undefined, null, {}, { rows: [] }, { state: 0 }, { state: 4 }, { state: 9 }, { state: "idle" }]) {
    assert.equal(createUsageImage(view), null);
  }
});

test("encodes the svg as a base64 data uri with the frozen canvas", () => {
  const svg = decode(createUsageImage(usageView(THREE_ROWS)));
  assert.equal(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), true);
  assert.match(svg, /width="196" height="196" viewBox="0 0 196 196"/);
  assert.match(svg, /<clipPath id="key-shape"><rect width="196" height="196" rx="12"\/><\/clipPath>/);
  assert.match(svg, /clip-path="url\(#key-shape\)"/);
  assert.equal(svg.endsWith("</svg>"), true);
});

test("uses the background colour of each state", () => {
  assert.equal(decode(createUsageImage(usageView(THREE_ROWS))).includes('fill="#0d1117"'), true);
  assert.equal(
    decode(createUsageImage({ state: 2, rows: THREE_ROWS, message: null, footer: "" })).includes('fill="#3b2600"'),
    true,
  );
  assert.equal(
    decode(createUsageImage({ state: 3, rows: [], message: "NO QUOTA", footer: "" })).includes('fill="#341216"'),
    true,
  );
});

test("draws the plugin and metric header only when there are rows", () => {
  const svg = decode(createUsageImage(usageView(THREE_ROWS, { footer: "RESET SEP 30" })));
  const header = single(svg, "data-header");
  const footer = single(svg, "data-footer");

  assert.equal(header.tag, "text");
  assert.equal(header.text, "NaN - USED");
  assert.equal(header.attributes["font-size"], String(HEADER_SIZE));
  assert.equal(header.attributes["font-family"], "Arial, sans-serif");
  assert.equal(header.attributes["font-weight"], "700");
  assert.equal(header.attributes.fill, "#8b949e");
  assert.equal(header.attributes.y, "26");

  // Same anchor and same anchor x as the footer, but its own baseline.
  assert.equal(header.attributes["text-anchor"], "middle");
  assert.equal(header.attributes.x, "98");
  assert.equal(header.attributes.x, footer.attributes.x);
  assert.equal(header.attributes["text-anchor"], footer.attributes["text-anchor"]);
  assert.notEqual(header.attributes.y, footer.attributes.y);

  for (const view of [
    { state: 3, rows: [], message: "NO QUOTA", footer: "" },
    { state: 3, rows: [], message: "NO QUOTA", footer: "RESET SEP 30" },
  ]) {
    assert.equal(decode(createUsageImage(view)).includes("data-header"), false);
  }
});

test("spells the header with one plain hyphen between single spaces", () => {
  assert.equal(HEADER_TEXT, "NaN - USED");
  assert.deepEqual(HEADER_TEXT.split(" - "), ["NaN", "USED"]);
  assert.equal(HEADER_TEXT.match(/-/g).length, 1);
  for (const separator of ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212", "_", "/", "|"]) {
    assert.equal(HEADER_TEXT.includes(separator), false, `${separator} is not the frozen separator`);
  }
  assert.equal(HEADER_TEXT, HEADER_TEXT.trim());
});

test("measures the header inside the safe width at its design size", () => {
  const width = estimateTextWidth(HEADER_TEXT, HEADER_SIZE);
  assert.ok(Math.abs(width - 124.674) < 1e-9);
  assert.ok(width <= TEXT_MAX_WIDTH);
  assert.ok(Math.abs(TEXT_MAX_WIDTH - width - 43.326) < 1e-9);

  const header = single(decode(createUsageImage(usageView(THREE_ROWS))), "data-header");
  assert.equal(header.attributes["font-size"], String(HEADER_SIZE));
  assert.equal(estimateTextWidth(header.text, HEADER_SIZE), width);

  // Negative control: the budget has to bite for a longer header, otherwise a
  // copy change would silently shrink the header instead of failing the suite.
  assert.ok(estimateTextWidth(`${HEADER_TEXT} EXTRA`, HEADER_SIZE) > TEXT_MAX_WIDTH);
});

test("keeps the taller header clear of the first row label", () => {
  const svg = decode(createUsageImage(usageView(THREE_ROWS)));
  const header = single(svg, "data-header");
  const label = single(svg, "data-row-label", 0);
  const headerY = Number(header.attributes.y);
  const headerSize = Number(header.attributes["font-size"]);
  const labelY = Number(label.attributes.y);
  const labelSize = Number(label.attributes["font-size"]);

  const headerTop = headerY - ASCENT_RATIO * headerSize;
  const headerBottom = headerY + DESCENT_RATIO * headerSize;
  const labelTop = labelY - ASCENT_RATIO * labelSize;

  assert.equal(headerTop, 9.5);
  assert.ok(Math.abs(headerBottom - 30.84) < 1e-9);
  assert.equal(labelTop, 49);
  assert.ok(Math.abs(labelTop - headerBottom - 18.16) < 1e-9);
  assert.ok(headerBottom < labelTop);
});

test("draws one label, track, fill and value per row", () => {
  const svg = decode(createUsageImage(usageView(THREE_ROWS)));
  for (let index = 0; index < ROW_LABEL_Y.length; index += 1) {
    const label = single(svg, "data-row-label", index);
    const track = single(svg, "data-row-bar-track", index);
    const fill = single(svg, "data-row-bar-fill", index);
    const value = single(svg, "data-row-value", index);
    const labelY = ROW_LABEL_Y[index];
    const barY = labelY + BAR_OFFSET;

    assert.equal(label.tag, "text");
    assert.equal(label.attributes.x, String(ROW_LABEL_X));
    assert.equal(label.attributes.y, String(labelY));
    assert.equal(label.attributes["text-anchor"], "start");
    assert.equal(label.attributes.fill, "#c9d1d9");
    assert.equal(label.text, THREE_ROWS[index].label);

    assert.equal(track.tag, "rect");
    assert.equal(track.attributes.x, "0");
    assert.equal(track.attributes.y, String(barY));
    assert.equal(track.attributes.width, String(BAR_WIDTH));
    assert.equal(track.attributes.height, String(BAR_HEIGHT));
    assert.equal(track.attributes.fill, "#30363d");

    assert.equal(fill.tag, "rect");
    assert.equal(fill.attributes.x, "0");
    assert.equal(fill.attributes.y, String(barY));
    assert.equal(fill.attributes.width, String(Number((BAR_WIDTH * THREE_ROWS[index].consumedPercent / 100).toFixed(3))));
    assert.equal(fill.attributes.height, String(BAR_HEIGHT));
    assert.equal(fill.attributes.fill, "#58a6ff");

    assert.equal(value.tag, "text");
    assert.equal(value.attributes.x, String(ROW_VALUE_X));
    assert.equal(value.attributes.y, String(barY + BAR_HEIGHT));
    assert.equal(value.attributes["text-anchor"], "end");
    assert.equal(value.attributes.fill, "#ffffff");
    assert.equal(value.text, `${THREE_ROWS[index].percent}%`);
  }

  assert.equal(byHook(svg, "data-row-label", 3).length, 0);
});

test("renames the percentage hook to data-row-value and drops data-row-percent", () => {
  const svg = decode(createUsageImage(usageView(THREE_ROWS)));
  assert.equal(byHook(svg, "data-row-value").length, 3);
  assert.equal(byHook(svg, "data-row-percent").length, 0);
  assert.equal(svg.includes("data-row-percent"), false);
});

test("sizes the bar fill from the exact consumed percentage", () => {
  const cases = [
    [0, "0"],
    [8.1, "9.153"],
    [1.3, "1.469"],
    [91.9, "103.847"],
    [33.333, "37.666"],
    [100, "113"],
  ];
  for (const [consumedPercent, expectedWidth] of cases) {
    const svg = decode(
      createUsageImage(usageView([row("glm5.3", "glm5.3", Math.round(consumedPercent), consumedPercent, 0)])),
    );
    const fill = single(svg, "data-row-bar-fill", 0);
    assert.equal(fill.attributes.width, expectedWidth);
    assert.equal(fill.attributes.x, "0");
    assert.equal(fill.attributes.y, String(ROW_LABEL_Y[0] + BAR_OFFSET));
  }
});

test("clamps the bar fill to the display range", () => {
  const over = single(decode(createUsageImage(usageView([row("m", "m", 100, 140.6, 50)]))), "data-row-bar-fill", 0);
  assert.equal(over.attributes.width, "113");

  const below = single(decode(createUsageImage(usageView([row("m", "m", 0, -20, 50)]))), "data-row-bar-fill", 0);
  assert.equal(below.attributes.width, "0");
});

test("keeps the track without a fill when the consumed percentage is unknown", () => {
  for (const consumedPercent of [Number.NaN, undefined, null, Number.POSITIVE_INFINITY, "91.9"]) {
    const svg = decode(createUsageImage(usageView([row("glm5.3", "glm5.3", 8, consumedPercent, 91.9)])));
    assert.equal(byHook(svg, "data-row-bar-fill", 0).length, 0);
    assert.equal(byHook(svg, "data-row-bar-track", 0).length, 1);
    assert.equal(single(svg, "data-row-value", 0).text, "8%");
  }
});

test("carries the rounded integer percentage on the bar's line", () => {
  const svg = decode(createUsageImage(usageView([row("glm5.3", "glm5.3", 8, 8.1, 91.9)])));
  const value = single(svg, "data-row-value", 0);
  assert.equal(value.text, "8%");
  assert.equal(value.attributes.y, "83");
  assert.equal(value.attributes["font-size"], String(ROW_VALUE_SIZE));

  const hundred = single(decode(createUsageImage(usageView([row("m", "m", 100, 99.9, 0.1)]))), "data-row-value", 0);
  assert.equal(hundred.text, "100%");
  assert.equal(hundred.attributes["font-size"], String(ROW_VALUE_SIZE));
});

test("defensively fits the value inside the clearance margin", () => {
  const svg = decode(createUsageImage(usageView([row("m", "m", 1234, 8.1, 91.9)])));
  const value = single(svg, "data-row-value", 0);
  const size = Number(value.attributes["font-size"]);

  assert.equal(value.text, "1234%");
  assert.ok(size < ROW_VALUE_SIZE);
  assert.ok(estimateTextWidth(value.text, size) <= VALUE_MAX_WIDTH);
});

test("draws at most three rows", () => {
  const rows = [...THREE_ROWS, row("extra", "extra", 50, 50, 50)];
  const svg = decode(createUsageImage(usageView(rows)));
  assert.equal(byHook(svg, "data-row-label", 3).length, 0);
  assert.equal(byHook(svg, "data-row-bar-track", 2).length, 1);
  assert.equal(byHook(svg, "data-row-value", 2).length, 1);
});

test("renders the footer only when it is a non-empty string", () => {
  const footer = single(decode(createUsageImage(usageView(THREE_ROWS, { footer: "RESET SEP 30" }))), "data-footer");
  assert.equal(footer.text, "RESET SEP 30");
  assert.equal(footer.attributes.x, "98");
  assert.equal(footer.attributes.y, "188");
  assert.equal(footer.attributes["font-size"], "15");
  assert.equal(footer.attributes.fill, "#8b949e");
  assert.equal(footer.attributes["text-anchor"], "middle");

  for (const footerValue of ["", undefined, null, 42]) {
    const svg = decode(createUsageImage(usageView(THREE_ROWS, { footer: footerValue })));
    assert.equal(svg.includes("data-footer"), false);
  }
});

test("renders the message only when there are no rows", () => {
  const message = single(decode(createUsageImage({ state: 3, rows: [], message: "NO QUOTA", footer: "" })), "data-message");
  assert.equal(message.text, "NO QUOTA");
  assert.equal(message.attributes.x, "98");
  assert.equal(message.attributes.y, "101");
  assert.equal(message.attributes.fill, "#f0a0a8");
  assert.equal(message.attributes["text-anchor"], "middle");
  assert.ok(Number(message.attributes["font-size"]) <= 34);
  assert.ok(estimateTextWidth(message.text, Number(message.attributes["font-size"])) <= TEXT_MAX_WIDTH);

  const short = single(decode(createUsageImage({ state: 3, rows: [], message: "NO", footer: "" })), "data-message");
  assert.equal(short.attributes["font-size"], "34");

  const withRows = decode(createUsageImage(usageView(THREE_ROWS, { message: "NO QUOTA" })));
  assert.equal(withRows.includes("data-message"), false);
  assert.equal(decode(createUsageImage({ state: 3, rows: [], message: "", footer: "" })).includes("data-message"), false);
});

test("auto-fits a label that cannot fit the full safe width", () => {
  const svg = decode(createUsageImage(usageView([row("glm5.3-flash", "glm5.3-flash-ultra-long-name", 100, 100, 0)])));
  const label = single(svg, "data-row-label", 0);
  const size = Number(label.attributes["font-size"]);

  assert.ok(size < ROW_LABEL_SIZE);
  assert.ok(estimateTextWidth(label.text, size) <= TEXT_MAX_WIDTH);
});

test("never shrinks a frozen model label now that the label owns its line", () => {
  const labels = Object.values(MODEL_LABELS);
  const widest = labels.reduce((left, right) =>
    estimateTextWidth(right, ROW_LABEL_SIZE) > estimateTextWidth(left, ROW_LABEL_SIZE) ? right : left);

  assert.equal(widest, "deepseek v4");
  assert.ok(Math.abs(estimateTextWidth(widest, ROW_LABEL_SIZE) - 118.96) < 1e-9);
  assert.ok(estimateTextWidth(widest, ROW_LABEL_SIZE) <= TEXT_MAX_WIDTH);

  for (const label of labels) {
    const svg = decode(createUsageImage(usageView([row("id", label, 8, 8.1, 91.9)])));
    const rendered = single(svg, "data-row-label", 0);
    assert.equal(rendered.attributes["font-size"], String(ROW_LABEL_SIZE), `${label} was shrunk`);
    assert.equal(rendered.text, label);
  }
});

test("escapes XML-sensitive text in the label, message and footer", () => {
  const svg = decode(
    createUsageImage({
      state: 3,
      rows: [],
      message: `<TOKEN>&"'`,
      footer: `A&B<C>"D"'E'`,
    }),
  );
  assert.equal(svg.includes("<TOKEN>"), false);
  assert.equal(single(svg, "data-message").text, "&lt;TOKEN&gt;&amp;&quot;&apos;");
  assert.equal(single(svg, "data-footer").text, "A&amp;B&lt;C&gt;&quot;D&quot;&apos;E&apos;");

  const indented = decode(
    createUsageImage({
      state: 1,
      rows: [row("m", `glm<5>&"'`, 50, 50, 50)],
      message: null,
      footer: "",
    }),
  );
  assert.equal(svg.includes("<5>"), false);
  assert.equal(single(indented, "data-row-label", 0).text, "glm&lt;5&gt;&amp;&quot;&apos;");
});

test("escapes every character the frozen helper escapes", () => {
  assert.equal(escapeXml(`<>&"'`), "&lt;&gt;&amp;&quot;&apos;");
  assert.equal(escapeXml(42), "42");
});

test("never throws for a malformed view", () => {
  const views = [
    { state: 1, rows: "glm5.3" },
    { state: 1, rows: [null, 42, "glm5.3", {}, THREE_ROWS[0]] },
    { state: 1, rows: THREE_ROWS, footer: 42, message: 42 },
    { state: 3, rows: [], message: null, footer: undefined },
    { state: 1, rows: [{ label: {}, percent: {}, consumedPercent: {}, remainingPercent: {} }] },
  ];
  for (const view of views) {
    let image;
    assert.doesNotThrow(() => {
      image = createUsageImage(view);
    });
    assert.ok(image === null || image.startsWith(DATA_URI_PREFIX));
  }
});

test("keeps the fitted font size inside the safe text width", () => {
  assert.equal(fitFontSize("USED", 15), 15);
  assert.equal(fitFontSize(HEADER_TEXT, HEADER_SIZE), HEADER_SIZE);
  assert.equal(estimateTextWidth("", 20), 0);
  const fitted = fitFontSize("glm5.3-flash-ultra-long-name", ROW_LABEL_SIZE, 100);
  assert.ok(fitted < ROW_LABEL_SIZE);
  assert.ok(estimateTextWidth("glm5.3-flash-ultra-long-name", fitted) <= 100);
});

test("renders well-formed xml for every view shape the host parses", () => {
  const views = [
    usageView(THREE_ROWS),
    usageView(THREE_ROWS, { state: 2 }),
    { state: 3, rows: [], message: "NO QUOTA", footer: "" },
    usageView(THREE_ROWS, { footer: "RESET SEP 30" }),
    usageView([row("unknown", "glm5.3", 8, null, 91.9)]),
    usageView([row("clipped", "deepseek v4", 100, 140.6, -20)]),
    usageView([row("escaped", `a&b<c>"d"`, 8, 8.1, 91.9)], { footer: `RESET <A&B>` }),
  ];
  for (const view of views) {
    assert.doesNotThrow(() => assertWellFormedSvg(decode(createUsageImage(view))));
  }
});

test("rejects a valueless attribute", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="key-shape"/></defs>'
    + '<text data-header x="98" y="26" fill="#8b949e">USED</text></svg>';
  assert.throws(() => assertWellFormedSvg(svg), /attribute " data-header [\s\S]*of <text> is not name="value"/);
});

test("rejects an unclosed tag, a mismatched closing tag and an underflow", () => {
  assert.throws(
    () => assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#key-shape)"/>'),
    /unclosed <svg>/,
  );
  assert.throws(
    () => assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#key-shape)"></svg>'),
    /closing <\/svg> does not match <g>/,
  );
  assert.throws(
    () => assertWellFormedSvg('</svg><svg xmlns="http://www.w3.org/2000/svg"/>'),
    /closing <\/svg> without an open tag/,
  );
});

test("rejects an unescaped raw & and an unescaped raw < in text", () => {
  assert.throws(
    () => assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>A&B</text></svg>'),
    /unescaped & at offset/,
  );
  assert.throws(
    () => assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>a < b</text></svg>'),
    /malformed opening tag < b<\/text>/,
  );
  assert.throws(
    () => assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><text><TOKEN></text></svg>'),
    /closing <\/text> does not match <TOKEN>/,
  );
  assert.doesNotThrow(() =>
    assertWellFormedSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>&amp;&lt;&gt;&quot;&apos;</text></svg>'));
});

module.exports = { assertWellFormedSvg, decode, elements };
