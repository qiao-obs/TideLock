(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ICON_PATHS = Object.freeze({
    // Bookmark / Pin icon (minimal geometric tack)
    pin: [
      { tag: 'path', d: 'M12 17v5' },
      { tag: 'path', d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' },
    ],
    refresh: [
      { tag: 'path', d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
      { tag: 'path', d: 'M3 3v5h5' },
      { tag: 'path', d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' },
      { tag: 'path', d: 'M16 16h5v5' },
    ],
    undo: [
      { tag: 'path', d: 'M3 7v6h6' },
      { tag: 'path', d: 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13' },
    ],
    close: [
      { tag: 'path', d: 'M18 6 6 18' },
      { tag: 'path', d: 'm6 6 12 12' },
    ],
    copy: [
      { tag: 'rect', x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' },
      { tag: 'path', d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' },
    ],
    check: [
      { tag: 'path', d: 'M20 6 9 17l-5-5' },
    ],
    layers: [
      { tag: 'path', d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' },
      { tag: 'path', d: 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65' },
      { tag: 'path', d: 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65' },
    ],
    compass: [
      { tag: 'circle', cx: '12', cy: '12', r: '10' },
      { tag: 'polygon', points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' },
    ],
    search: [
      { tag: 'circle', cx: '11', cy: '11', r: '8' },
      { tag: 'path', d: 'm21 21-4.3-4.3' },
    ],
    arrowLeft: [
      { tag: 'path', d: 'm12 19-7-7 7-7' },
      { tag: 'path', d: 'M19 12H5' },
    ],
  });

  function createSvgIcon(name, size = 15, opts = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', opts.filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(opts.strokeWidth || 2));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const shapes = ICON_PATHS[name] || ICON_PATHS.layers;
    for (const shape of shapes) {
      const el = document.createElementNS(SVG_NS, shape.tag);
      for (const [k, v] of Object.entries(shape)) {
        if (k === 'tag') continue;
        el.setAttribute(k, v);
      }
      svg.appendChild(el);
    }
    return svg;
  }

  const api = { createSvgIcon };
  if (typeof root !== 'undefined') {
    root.__TideLockIcons = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
