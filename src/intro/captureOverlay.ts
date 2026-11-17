/** Composite the film's DOM overlays on the local-export canvas using their actual layout. */
export function captureOverlay(ctx: CanvasRenderingContext2D, root: HTMLElement) {
  const base = root.getBoundingClientRect();
  const rect = (element: Element) => {
    const r = element.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
  };
  const colors = getComputedStyle(root);
  const color = (name: string, fallback: string) => colors.getPropertyValue(name).trim() || fallback;
  const opacity = (element: Element) => Number.parseFloat(getComputedStyle(element).opacity) || 0;
  const shade = root.querySelector<HTMLElement>('.brand-shade');
  if (shade && opacity(shade) > 0) {
    const r = rect(shade);
    ctx.save();
    ctx.globalAlpha = opacity(shade);
    ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
    ctx.scale(r.width / 2, r.height / 2);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, 'rgba(8,3,0,.62)');
    gradient.addColorStop(.45, 'rgba(8,3,0,.3)');
    gradient.addColorStop(.72, 'rgba(8,3,0,0)');
    gradient.addColorStop(1, 'rgba(8,3,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  for (const glyph of root.querySelectorAll<HTMLElement>('.glyph:not(.glyph-space)')) {
    const alpha = opacity(glyph);
    if (!alpha) continue;
    const r = rect(glyph);
    const style = getComputedStyle(glyph);
    const transform = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const scale = transform.a;
    const fontSize = Number.parseFloat(style.fontSize) * scale;
    const lineHeight = Number.parseFloat(style.lineHeight) * scale;
    ctx.save();
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(glyph.textContent || '');
    const ascent = metrics.fontBoundingBoxAscent || fontSize * .8;
    const descent = metrics.fontBoundingBoxDescent || fontSize * .2;
    const baseline = r.y + (lineHeight - ascent - descent) / 2 + ascent;
    const gold = ctx.createLinearGradient(0, r.y, 0, r.y + r.height);
    gold.addColorStop(0, color('--title-light', '#fff6d6')); gold.addColorStop(.3, color('--title-mid', '#ffe3a0'));
    gold.addColorStop(.62, color('--title-gold', '#f0b24a')); gold.addColorStop(1, color('--title-dark', '#c98a22'));
    ctx.globalAlpha = alpha;
    ctx.filter = style.filter;
    ctx.shadowColor = 'rgba(255,170,40,.45)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = gold;
    ctx.fillText(glyph.textContent || '', r.x, baseline);
    ctx.restore();
  }
  const rule = root.querySelector<HTMLElement>('.brand-rule');
  if (rule && opacity(rule) > 0) {
    const r = rect(rule);
    const gradient = ctx.createLinearGradient(r.x, 0, r.x + r.width, 0);
    gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.5, 'rgba(255,215,130,.9)'); gradient.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalAlpha = opacity(rule); ctx.fillStyle = gradient; ctx.fillRect(r.x, r.y, r.width, r.height); ctx.restore();
  }
  const tagline = root.querySelector<HTMLElement>('.tagline');
  if (tagline && opacity(tagline) > 0) {
    const r = rect(tagline);
    const style = getComputedStyle(tagline);
    const fontSize = Number.parseFloat(style.fontSize);
    const spacing = Number.parseFloat(style.letterSpacing) || 0;
    ctx.save();
    ctx.globalAlpha = opacity(tagline);
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText('ВЕЧЕР');
    const ascent = metrics.fontBoundingBoxAscent || fontSize * .8;
    const descent = metrics.fontBoundingBoxDescent || fontSize * .2;
    const baseline = r.y + (r.height - ascent - descent) / 2 + ascent;
    let x = r.x + Number.parseFloat(style.paddingLeft);
    for (const letter of tagline.textContent || '') {
      ctx.fillText(letter, x, baseline);
      x += ctx.measureText(letter).width + spacing;
    }
    ctx.restore();
  }
  // Bars are above the title in the browser's stacking order.
  ctx.fillStyle = '#000';
  for (const bar of root.querySelectorAll<HTMLElement>('.letterbox')) {
    const r = rect(bar);
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  const rings = root.querySelector<HTMLCanvasElement>('.corner-rings');
  if (rings) ctx.drawImage(rings, 0, 0, base.width, base.height);
  const fade = root.querySelector<HTMLElement>('.film-fade');
  if (fade && opacity(fade) > 0) {
    ctx.save();
    ctx.globalAlpha = opacity(fade);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, base.width, base.height);
    ctx.restore();
  }
}
