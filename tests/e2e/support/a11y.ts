import { expect, type Locator, type Page } from "@playwright/test";

// Move focus with Tab only until `target` is focused, then check that the
// focus indicator is visible. Fails if the control is not in the tab order.
export async function tabTo(page: Page, target: Locator, limit = 250) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return expectVisibleFocus(target);
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach ${target} with the keyboard.`);
}

export async function expectVisibleFocus(target: Locator) {
  const outline = await target.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style, "focus outline").not.toBe("none");
  expect(outline.width, "focus outline width").toBeGreaterThanOrEqual(2);
}

export async function typeInto(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
}

export type ContrastFailure = {
  text: string;
  ratio: number;
  color: string;
  background: string;
};

// WCAG 2.x contrast for rendered text against its composited background.
// Disabled controls are exempt (WCAG 1.4.3 inactive components).
export async function contrastFailures(page: Page): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: number) =>
        (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const background = (node: Element | null): RGBA => {
      const layers: RGBA[] = [];
      for (let el = node; el; el = el.parentElement) {
        const color = parse(getComputedStyle(el).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      return layers.reduceRight<RGBA>(
        (acc, layer) => over(layer, acc),
        [255, 255, 255, 1],
      );
    };
    const luminance = ([r, g, b]: RGBA) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const failures: {
      text: string;
      ratio: number;
      color: string;
      background: string;
    }[] = [];
    const nodes = document.querySelectorAll(
      "main h1, main h2, main p, main label, main a, main button, main th, main td, main dt, main dd, main legend, main li, main span, header a, header button, header p",
    );
    for (const node of nodes) {
      const el = node as HTMLElement;
      const text = Array.from(el.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => c.textContent ?? "")
        .join("")
        .trim();
      if (!text || el.closest(".sr-only") || !el.offsetParent) continue;
      if (el.closest(":disabled, [aria-disabled=true]")) continue;
      const bg = background(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = parseFloat(getComputedStyle(el).fontSize);
      const bold = Number(getComputedStyle(el).fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      if (ratio < (large ? 3 : 4.5))
        failures.push({
          text: text.slice(0, 60),
          ratio: Math.round(ratio * 100) / 100,
          color: getComputedStyle(el).color,
          background: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
        });
    }
    return failures;
  });
}
