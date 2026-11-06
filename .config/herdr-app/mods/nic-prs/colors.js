function channels(color) {
  if (typeof color !== "string" || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)) return null;
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .concat(color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1);
}

function luminance(rgb) {
  return rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

// Terminal ANSI colors can suit a dark terminal but disappear on a light panel.
// Preserve the selected theme's status ink when readable, else use its UI ink.
export function readableText(preferred, background, foreground) {
  const ink = channels(preferred), paper = channels(background);
  if (!ink || !paper) return foreground;
  const painted = ink.slice(0, 3).map((value, index) => value * ink[3] + paper[index] * (1 - ink[3]));
  const light = luminance(painted), dark = luminance(paper.slice(0, 3));
  const contrast = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  return contrast >= 4.5 ? preferred : foreground;
}
