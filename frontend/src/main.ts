const SLOT_COLOR = ['#ff0000', '#00ff00', '#ffff00'] as const;

type JewelSize = 'large' | 'medium' | 'small';

interface AtlasCoord { x: number; y: number; w: number; h: number; }

interface Notable {
    name: string;
    id: number;
    kind: 'prefix' | 'suffix';
    clusterKey: string;
    jewelSize: JewelSize;
    atlas: AtlasCoord;
    stats: string[];
}

interface ClusterType {
    prefix_notables: { name: string; id: number; stats?: string[] }[];
    suffix_notables: { name: string; id: number; stats?: string[] }[];
    atlas: AtlasCoord;
    small_passive_stats: string[];
}

interface NotableIdEntry {
    name: string;
    id: number;
    required_level: number;
    implicit_tags: string[];
    spawn_tags: { weight: number; tag: string }[];
    placements: unknown[];
}

const allData: Record<JewelSize, Record<string, ClusterType>> = {
    large: {},
    medium: {},
    small: {},
};

let notableIds: Record<string, NotableIdEntry> = {};
let atlasImage: HTMLImageElement | null = null;
let data: Record<string, ClusterType> = {};
let slots: [Notable | null, Notable | null, Notable | null] = [null, null, null];
let activeSlot: 0 | 1 | 2 = 0;
let currentJewelSize: JewelSize = 'large';
let activeTagFilters: Set<string> = new Set();

// Pane search state — persists across advanced-mode toggles, cluster changes, etc.
const paneFilters: { prefix: string; suffix: string } = { prefix: '', suffix: '' };

// Advanced mode — show all notables from every cluster key in current jewel size
let advancedMode = false;

const MAX_SLOTS: Record<JewelSize, number>  = { large: 3, medium: 2, small: 1 };
const MAX_PREFIX: Record<JewelSize, number> = { large: 2, medium: 2, small: 1 };

const prettyKey = (k: string): string => k.replace('affliction_', '').replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// Atlas rendering
// ---------------------------------------------------------------------------

function applyAtlasToCanvas(canvas: HTMLCanvasElement, coord: AtlasCoord): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || !atlasImage) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(atlasImage, coord.x, coord.y, coord.w, coord.h, 0, 0, canvas.width, canvas.height);
}

let _canvasQueue: { id: string; coord: AtlasCoord }[] = [];

function atlasCanvasTag(id: string, coord: AtlasCoord, size: number, extraClass = ''): string {
    _canvasQueue.push({ id, coord });
    return `<canvas id="${id}" width="${size}" height="${size}" class="${extraClass}" style="border-radius:5px;background:var(--surface-3);display:block;"></canvas>`;
}

function flushCanvasQueue(): void {
    for (const { id, coord } of _canvasQueue) {
        const canvas = document.getElementById(id) as HTMLCanvasElement | null;
        if (canvas) applyAtlasToCanvas(canvas, coord);
    }
    _canvasQueue = [];
}

const _svgAtlasCache = new Map<string, string>();

function atlasDataUrl(coord: AtlasCoord): string {
    const key = `${coord.x},${coord.y}`;
    if (_svgAtlasCache.has(key)) return _svgAtlasCache.get(key)!;
    if (!atlasImage) return '';
    const c = document.createElement('canvas');
    c.width = 56; c.height = 56;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(atlasImage, coord.x, coord.y, coord.w, coord.h, 0, 0, 56, 56);
    const url = c.toDataURL();
    _svgAtlasCache.set(key, url);
    return url;
}

// ---------------------------------------------------------------------------
// Tag color system — golden-ratio HSL spread
// ---------------------------------------------------------------------------

const _tagHueCache = new Map<string, number>();

function tagHue(word: string): number {
    if (_tagHueCache.has(word)) return _tagHueCache.get(word)!;
    let h = 5381;
    for (let i = 0; i < word.length; i++) h = ((h << 5) + h + word.charCodeAt(i)) >>> 0;
    const hue = (h * 137.508) % 360;
    _tagHueCache.set(word, hue);
    return hue;
}

function tagColors(word: string): { bg: string; border: string; text: string } {
    const h = tagHue(word);
    return {
        bg:     `hsla(${h}, 55%, 28%, 0.22)`,
        border: `hsla(${h}, 60%, 52%, 0.50)`,
        text:   `hsl(${h}, 80%, 73%)`,
    };
}

function tagStyle(word: string): string {
    const c = tagColors(word);
    return `background:${c.bg};border-color:${c.border};color:${c.text};`;
}

// ---------------------------------------------------------------------------
// notable_ids helpers
// ---------------------------------------------------------------------------

function getNotableInfo(name: string): NotableIdEntry | null {
    return notableIds[name] ?? null;
}

function renderNotableTags(name: string): string {
    const info = getNotableInfo(name);
    if (!info) return '';
    const tags: string[] = [];
    if (info.required_level > 0) {
        tags.push(`<span class="ni-tag ni-tag--ilvl" style="${tagStyle('ilvl')}">ilvl ${info.required_level}</span>`);
    }
    for (const t of info.implicit_tags) {
        tags.push(`<span class="ni-tag" style="${tagStyle(t)}">${t}</span>`);
    }
    return tags.join('');
}

// ---------------------------------------------------------------------------
// Highlight bar
// ---------------------------------------------------------------------------

function getAllTagsForCluster(clusterKey: string): string[] {
    const all = getAllNotablesForSource(clusterKey);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const n of all) {
        const info = getNotableInfo(n.name);
        if (!info) continue;
        for (const t of info.implicit_tags) {
            if (!seen.has(t)) { seen.add(t); result.push(t); }
        }
    }
    return result.sort();
}

function renderHighlightBar(): void {
    const bar = document.getElementById('highlightBar') as HTMLElement;
    const tags = getAllTagsForCluster(currentClusterKey());
    if (tags.length === 0) { bar.innerHTML = ''; return; }
    bar.innerHTML = tags.map(t => {
        const active = activeTagFilters.has(t);
        return `<button class="hl-tag${active ? ' hl-tag--active' : ''}" onclick="handleHighlightTag('${t}')" style="${tagStyle(t)}">${t}</button>`;
    }).join('');
}

function notableMatchesFilter(name: string): boolean {
    if (activeTagFilters.size === 0) return true;
    const info = getNotableInfo(name);
    if (!info) return false;
    return info.implicit_tags.some(t => activeTagFilters.has(t));
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

let _tooltipEl: HTMLElement | null = null;

function getTooltip(): HTMLElement {
    if (!_tooltipEl) {
        _tooltipEl = document.createElement('div');
        _tooltipEl.className = 'ni-tooltip';
        document.body.appendChild(_tooltipEl);
    }
    return _tooltipEl;
}

function showTooltip(lines: string[], anchorEl: HTMLElement): void {
    if (!lines.length) return;
    const tip = getTooltip();
    tip.innerHTML = lines.map(l => `<div class="ni-tooltip-line">${l}</div>`).join('');
    tip.style.display = 'block';
    requestAnimationFrame(() => positionTooltip(anchorEl));
}

function positionTooltip(anchorEl: HTMLElement): void {
    const tip = getTooltip();
    const rect = anchorEl.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const pad = 10;
    let left = rect.right + pad;
    let top  = rect.top + rect.height / 2 - th / 2;
    if (left + tw > window.innerWidth - pad) left = rect.left - tw - pad;
    top = Math.max(pad, Math.min(top, window.innerHeight - th - pad));
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top  = `${top  + window.scrollY}px`;
}

function hideTooltip(): void {
    if (_tooltipEl) _tooltipEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Pane search / filter
// ---------------------------------------------------------------------------

/**
 * Build a matcher for a raw query string.
 * Tries to compile it as a regex; on failure falls back to case-insensitive
 * substring. Returns a function that tests a notable.
 */
function buildMatcher(query: string): ((n: Notable) => boolean) | null {
    const q = query.trim();
    if (!q) return null; // no filter

    let re: RegExp | null = null;
    try {
        re = new RegExp(q, 'i');
    } catch {
        // invalid regex — treat as plain substring
    }

    return (n: Notable): boolean => {
        if (re) {
            if (re.test(n.name)) return true;
            return n.stats.some(s => re!.test(s));
        }
        const lower = q.toLowerCase();
        if (n.name.toLowerCase().includes(lower)) return true;
        return n.stats.some(s => s.toLowerCase().includes(lower));
    };
}

// Sync the input DOM value back from state (called after render rebuilds the header)
function syncPaneFilterInputs(): void {
    for (const kind of ['prefix', 'suffix'] as const) {
        const el = document.getElementById(`${kind}Search`) as HTMLInputElement | null;
        if (el) el.value = paneFilters[kind];
    }
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Get all notables that should populate a given pane kind.
 * In advanced mode: all notables from every cluster key in `data`.
 * In normal mode: only notables from the selected cluster key.
 */
function getAllNotablesForSource(clusterKey: string): Notable[] {
    if (advancedMode) {
        const seen = new Set<number>();
        const result: Notable[] = [];
        for (const key of Object.keys(data)) {
            for (const n of getAllNotablesForCluster(key)) {
                if (!seen.has(n.id)) { seen.add(n.id); result.push(n); }
            }
        }
        return result.sort((a, b) => a.id - b.id);
    }
    return getAllNotablesForCluster(clusterKey);
}

function getAllNotablesForCluster(clusterKey: string): Notable[] {
    const ct = data[clusterKey];
    if (!ct) return [];
    return [
        ...ct.prefix_notables.map(n => ({
            ...n,
            kind: 'prefix' as const,
            clusterKey,
            jewelSize: currentJewelSize,
            atlas: ct.atlas,
            stats: n.stats ?? [],
        })),
        ...ct.suffix_notables.map(n => ({
            ...n,
            kind: 'suffix' as const,
            clusterKey,
            jewelSize: currentJewelSize,
            atlas: ct.atlas,
            stats: n.stats ?? [],
        })),
    ].sort((a, b) => a.id - b.id);
}

function currentClusterKey(): string {
    return (document.getElementById('clusterSelect') as HTMLSelectElement).value;
}

function notablesForSvgPositions(): [Notable | null, Notable | null, Notable | null] {
    const filled = slots.filter((n): n is Notable => n !== null).sort((a, b) => a.id - b.id);
    if (filled.length === 0) return [null, null, null];
    if (filled.length === 1) return [filled[0], null, null];
    if (filled.length === 2) return [filled[0], filled[1], null];
    return [filled[1], filled[2], filled[0]];
}

function kindCount(kind: 'prefix' | 'suffix', exclude?: number): number {
    return slots.filter((s, i) => s !== null && s.kind === kind && i !== exclude).length;
}

function slotAvailable(i: number): boolean {
    const maxSlots = MAX_SLOTS[currentJewelSize];
    if (i >= maxSlots) return false;
    if (i === 0) return true;
    if (i === 1) return slots[0] !== null;
    return slots[0] !== null && slots[1] !== null;
}

function hasMixedKinds(): boolean {
    const s0 = slots[0], s1 = slots[1];
    return !!(s0 && s1 && s0.kind !== s1.kind);
}

function isFractured(i: number): boolean {
    if (advancedMode) {
        // Advanced mode: slot 0 is fractured when slot 1 is from a different cluster type
        if (i !== 0) return false;
        const s0 = slots[0], s1 = slots[1];
        return !!(s0 && s1 && s1.clusterKey !== s0.clusterKey);
    }
    // Normal mode: slot 0 is fractured when the current cluster/size differs from what was selected
    if (i !== 0) return false;
    const n = slots[0];
    return !!(n && (n.clusterKey !== currentClusterKey() || n.jewelSize !== currentJewelSize));
}

function isImprinted(i: number): boolean {
    if (i !== 1) return false;
    // Imprint only applies when slot 0 and slot 1 are mixed kinds (one prefix + one suffix)
    if (!hasMixedKinds()) return false;
    if (advancedMode) {
        // Advanced mode: slot 1 is imprinted when slot 2 is from a different cluster type than slot 1
        const s1 = slots[1], s2 = slots[2];
        return !!(s1 && s2 && s2.clusterKey !== s1.clusterKey);
    }
    // Normal mode: slot 1 is imprinted when the current cluster/size differs from what was selected
    const n = slots[1];
    return !!(n && (n.clusterKey !== currentClusterKey() || n.jewelSize !== currentJewelSize));
}

function setActiveSlot(i: 0 | 1 | 2): void {
    if (!slotAvailable(i)) return;
    slots[i] = null;
    if (i === 0) { slots[1] = null; slots[2] = null; }
    if (i === 1) { slots[2] = null; }
    activeSlot = i;
    render();
}

function clearSlot(i: 0 | 1 | 2): void {
    slots[i] = null;
    if (i === 0) { slots[1] = null; slots[2] = null; }
    if (i === 1) { slots[2] = null; }
    activeSlot = i;
    render();
}

function selectNotable(n: Notable): void {
    if (slots[activeSlot]?.id === n.id) { slots[activeSlot] = null; render(); return; }
    const maxPrefix = MAX_PREFIX[currentJewelSize];
    if (n.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1) return;
    if (n.kind === 'prefix' && kindCount('prefix', activeSlot) >= maxPrefix) return;
    if (slots.some((s, i) => i !== activeSlot && s?.id === n.id)) return;
    slots[activeSlot] = n;
    const nextSlot = ([0, 1, 2] as const).slice(0, MAX_SLOTS[currentJewelSize])
        .find(i => i > activeSlot && slots[i] === null && slotAvailable(i));
    if (nextSlot !== undefined) activeSlot = nextSlot;
    render();
}

// ---------------------------------------------------------------------------
// SVG layout
// ---------------------------------------------------------------------------

const SLOT_FILTER = ['url(#outline-red)', 'url(#outline-green)', 'url(#outline-blue)'] as const;

function setSvgNotable(svgIndex: 1 | 2 | 3, n: Notable | null): void {
    const selectionSlot = n ? slots.findIndex(s => s?.id === n.id) : -1;
    const filter  = selectionSlot !== -1 ? SLOT_FILTER[selectionSlot] : 'url(#outline-red)';
    const icon    = document.getElementById(`svg-notable-icon${svgIndex}`) as SVGImageElement | null;
    const overlay = document.getElementById(`svg-notable-overlay${svgIndex}`) as SVGImageElement | null;
    const label   = document.getElementById(`svg-notable-label${svgIndex}`);
    if (icon) {
        icon.setAttribute('href', n ? atlasDataUrl(n.atlas) : '');
        icon.setAttribute('opacity', n ? '1' : '0');
    }
    if (overlay) {
        overlay.setAttribute('filter', filter);
        overlay.setAttribute('opacity', n ? '1' : '0');
    }
    if (label) {
        label.textContent = '';
        label.setAttribute('opacity', '0');
    }
}

function renderSvg(): void {
    const [s1, s2, s3] = notablesForSvgPositions();
    setSvgNotable(1, s1);
    setSvgNotable(2, s2);
    setSvgNotable(3, s3);
}

function renderSvgLayout(): void {
    const body = document.getElementById('jewel-svg-body') as Element;
    while (body.firstChild) body.removeChild(body.firstChild);

    if (currentJewelSize === 'large') {
        body.innerHTML = `
            <g fill="none" stroke-width="6" stroke="#444">
                <line x1="0" y1="-150" x2="0" y2="-100"/>
                <path d="M 0 -100 A 100 100 0 0 1 87 -50"/>
                <path d="M 87 -50 A 100 100 0 0 1 87 50"/>
                <path d="M 87 50 A 100 100 0 0 1 50 87"/>
                <path d="M 50 87 A 100 100 0 0 1 0 100"/>
                <path d="M 0 100 A 100 100 0 0 1 -50 87"/>
                <path d="M -50 87 A 100 100 0 0 1 -87 50"/>
                <path d="M -87 50 A 100 100 0 0 1 -87 -50"/>
                <path d="M -87 -50 A 100 100 0 0 1 0 -100"/>
            </g>
            <g stroke="#333" fill="#2a2a2a">
                <circle cx="0"   cy="-100" r="14"/>
                <circle cx="-50" cy="87"   r="14"/>
                <circle cx="50"  cy="87"   r="14"/>
            </g>
            <image x="-113" y="24" width="52" height="52" href="./media/socket.png" opacity="1.0"/>
            <image x="61"   y="24" width="52" height="52" href="./media/socket.png" opacity="1.0"/>
            <image id="svg-notable-icon1"    x="-28" y="72"  width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-28" y="72"  width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="0"   y="148" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="-115" y="-78" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="-115" y="-78" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="-87"  y="-95" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="59"  y="-78" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="59"  y="-78" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="87"  y="-95" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;
    } else if (currentJewelSize === 'medium') {
        body.innerHTML = `
            <g fill="none" stroke-width="6" stroke="#444">
                <line x1="0" y1="-150" x2="0" y2="-100"/>
                <circle cx="0" cy="0" r="100" fill="none"/>
            </g>
            <g stroke="#333" fill="#2a2a2a">
                <circle cx="0" cy="-100" r="14"/>
            </g>
            <image x="-26" y="74" width="52" height="52" href="./media/socket.png" opacity="1.0"/>
            <image id="svg-notable-icon1"    x="-128" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-128" y="-28" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="-100" y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="72"   y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="72"   y="-28" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="100"  y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="-28" y="-28" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;
    } else {
        body.innerHTML = `
            <g fill="none" stroke-width="6" stroke="#444">
                <line x1="0" y1="-150" x2="0" y2="-100"/>
                <path d="M 0 -100 A 100 100 0 0 0 0 100"/>
            </g>
            <g stroke="#333" fill="#2a2a2a">
                <circle cx="-100" cy="0" r="14"/>
            </g>
            <image id="svg-notable-icon1"    x="-28" y="72" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-28" y="72" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="0"   y="148" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="-28" y="-28" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="-28" y="-28" width="56" height="56" href="./media/overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;
    }
}

// ---------------------------------------------------------------------------
// Slot headers
// ---------------------------------------------------------------------------

function renderSlotHeaders(): void {
    const maxSlots = MAX_SLOTS[currentJewelSize];
    const container = document.getElementById('slotHeaders') as HTMLElement;
    const visibleSlots = ([0, 1, 2] as const).slice(0, maxSlots);
    _canvasQueue = [];

    container.innerHTML = visibleSlots.map(i => {
        const n = slots[i];
        const isActive = i === activeSlot;
        const available = slotAvailable(i);
        const dotColor = n ? SLOT_COLOR[i] : null;
        const fractured = isFractured(i);
        const imprinted = isImprinted(i);
        let cls = 'slot-card';
        if (isActive) cls += ' active';
        if (!available) cls += ' locked';
        if (fractured) cls += ' fractured';
        if (imprinted) cls += ' imprinted';

        const iconHtml = n ? atlasCanvasTag(`slot-canvas-${i}`, n.atlas, 37, 'slot-icon') : '';
        const statsAttr = n && n.stats.length
            ? ` data-stats="${encodeURIComponent(JSON.stringify(n.stats))}" onmouseenter="handleNotableHover(event)" onmouseleave="handleNotableLeave()"`
            : '';

        return `<div class="${cls}"${statsAttr} onclick="handleSlotClick(${i})">
  <div class="slot-num ${isActive ? 'active' : ''}">${i + 1}</div>
  <div class="slot-content">
    ${!available
            ? `<span class="slot-locked">select ${i === 1 ? 'first' : 'second'} notable first</span>`
            : n
                ? `<div class="slot-icon-wrap">
           ${iconHtml}
           ${dotColor ? `<span class="pos-dot" style="background:${dotColor}"></span>` : ''}
         </div>
         <div class="slot-text">
           <div class="slot-name">${n.name}</div>
           <div class="slot-meta"><span class="slot-meta-text">${n.kind} &middot; ${n.id} &middot; ${prettyKey(n.clusterKey)}</span>${fractured ? '<span class="fractured-tag">fractured</span>' : ''}${imprinted ? '<span class="imprint-tag">imprinted</span>' : ''}</div>
         </div>
         <button class="slot-clear" onclick="event.stopPropagation();handleClearSlot(${i})">✕</button>`
                : '<span class="slot-empty">empty — click to select</span>'}
  </div>
</div>`;
    }).join('');

    flushCanvasQueue();
}

// ---------------------------------------------------------------------------
// Notable list pane
// ---------------------------------------------------------------------------

function renderNotablePane(kind: 'prefix' | 'suffix'): void {
    const clusterKey = currentClusterKey();
    const source = getAllNotablesForSource(clusterKey).filter(n => n.kind === kind);

    // Apply pane search filter
    const matcher = buildMatcher(paneFilters[kind]);
    const all = matcher ? source.filter(matcher) : source;

    const isLarge = currentJewelSize === 'large';
    const placedIds = slots.filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const sorted2 = [slots[0], slots[1]].filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const loId = sorted2.length >= 2 ? sorted2[0] : null;
    const hiId = sorted2.length >= 2 ? sorted2[1] : null;
    const firstId = slots[0]?.id ?? null;
    const belowFirst = (n: Notable) =>
        activeSlot === 1 && slots[1] === null && firstId !== null && n.kind === 'prefix' && n.id < firstId;
    const isInWindow = (n: Notable) => loId !== null && hiId !== null && n.id > loId && n.id < hiId;
    const currentKind = slots[activeSlot]?.kind;
    const maxPrefix = MAX_PREFIX[currentJewelSize];
    const suffixBlocked = (n: Notable) => n.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1 && currentKind !== 'suffix';
    const prefixBlocked = (n: Notable) => n.kind === 'prefix' && kindCount('prefix', activeSlot) >= maxPrefix && currentKind !== 'prefix';
    const isUndesired = (n: Notable): boolean => {
        if (!isLarge) return false;
        if (placedIds.length < 2 || loId === null || hiId === null) return false;
        return n.id <= loId || n.id >= hiId;
    };

    const listEl = document.getElementById(`${kind}List`) as HTMLElement;
    listEl.innerHTML = all.map(n => {
        const isThisSlot  = slots[activeSlot]?.id === n.id;
        const isOtherSlot = !isThisSlot && slots.some(s => s?.id === n.id);
        const isBlocked   = !isThisSlot && (suffixBlocked(n) || prefixBlocked(n));
        const undesired   = isLarge && !isBlocked && isUndesired(n);
        const inWindow    = isLarge && !isBlocked && isInWindow(n) && n.kind === 'prefix';
        const isVariant   = isLarge && !isBlocked && !inWindow && belowFirst(n);
        const clickable   = !isOtherSlot && !isBlocked;
        const usedInSlot  = slots.findIndex(s => s?.id === n.id);
        const tagDimmed   = activeTagFilters.size > 0 && !notableMatchesFilter(n.name) && !isThisSlot && !isOtherSlot;

        let cls = 'notable-item';
        if (isThisSlot)       cls += ' is-selected';
        else if (isOtherSlot) cls += ' is-used';
        else if (isBlocked)   cls += ' is-blocked';
        else if (inWindow)    cls += ' in-window';
        if (undesired)        cls += ' is-undesired';
        if (clickable)        cls += ' clickable';
        if (isVariant)        cls += ' is-variant';
        if (tagDimmed)        cls += ' tag-dimmed';

        const statusTags = isLarge
            ? (!isThisSlot && !isOtherSlot && inWindow  ? '<span class="desired-tag">desired</span>'   : '') +
            (!isThisSlot && !isOtherSlot && isVariant ? '<span class="variant-tag">2-notable variant</span>' : '') +
            (!isThisSlot && !isOtherSlot && undesired ? '<span class="undesired-tag">undesired</span>' : '')
            : '';

        const notableTags = renderNotableTags(n.name);
        const statsEncoded = encodeURIComponent(JSON.stringify(n.stats));

        const clusterRow = advancedMode
            ? `<div class="ni-cluster-row">${prettyKey(n.clusterKey)}</div>`
            : '';

        return `<div class="${cls}" ${clickable ? `onclick="handleNotableClick('${n.clusterKey}',${n.id})"` : ''} data-stats="${statsEncoded}" onmouseenter="handleNotableHover(event)" onmouseleave="handleNotableLeave()">
  <div class="ni-main">
    <div class="ni-top-row">
      <span class="ni-name">${n.name}</span>
      <div class="ni-right">
        ${statusTags}
        ${isBlocked && !isThisSlot && !isOtherSlot ? `<span class="blocked-tag">${n.kind === 'suffix' ? 'suffix taken' : 'prefix limit'}</span>` : ''}
        ${isOtherSlot ? `<span class="used-tag">selection ${usedInSlot + 1}</span>` : ''}
        <span class="ni-id">${n.id}</span>
      </div>
    </div>
    ${clusterRow}
    ${notableTags ? `<div class="ni-bottom-row">${notableTags}</div>` : ''}
  </div>
</div>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Select helpers
// ---------------------------------------------------------------------------

function populateClusterSelect(): void {
    const sel = document.getElementById('clusterSelect') as HTMLSelectElement;
    sel.innerHTML = '';
    Object.keys(data)
        .sort((a, b) => prettyKey(a).localeCompare(prettyKey(b)))
        .forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = prettyKey(k);
            sel.appendChild(o);
        });
}

function updateSelectLocks(): void {
    const bothPrefix = currentJewelSize === 'large' && slots[1] !== null && !hasMixedKinds();
    (document.getElementById('clusterSelect') as HTMLSelectElement).disabled = bothPrefix;
    const jewelTypeLocked = slots[0] !== null;
    (document.getElementById('jewelTypeSelect') as HTMLSelectElement).disabled = jewelTypeLocked;
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

function render(): void {
    renderSvg();
    renderSlotHeaders();
    renderHighlightBar();
    renderNotablePane('prefix');
    renderNotablePane('suffix');
    updateSelectLocks();
    // Restore input values after innerHTML replacement
    syncPaneFilterInputs();
}

// ---------------------------------------------------------------------------
// Global handlers
// ---------------------------------------------------------------------------

type G = Window & typeof globalThis & Record<string, unknown>;
(window as G).handleSlotClick    = (i: number) => setActiveSlot(i as 0 | 1 | 2);
(window as G).handleClearSlot    = (i: number) => clearSlot(i as 0 | 1 | 2);
(window as G).handleNotableClick = (clusterKey: string, id: number) => {
    const notable = getAllNotablesForCluster(clusterKey).find(n => n.id === id);
    if (notable) selectNotable(notable);
};
(window as G).handleHighlightTag = (tag: string) => {
    if (activeTagFilters.has(tag)) activeTagFilters.delete(tag);
    else activeTagFilters.add(tag);
    render();
};
(window as G).handleNotableHover = (event: MouseEvent) => {
    const el = event.currentTarget as HTMLElement;
    const raw = el.getAttribute('data-stats');
    if (!raw) return;
    try {
        const stats: string[] = JSON.parse(decodeURIComponent(raw));
        if (stats.length) showTooltip(stats, el);
    } catch { /* ignore */ }
};
(window as G).handleNotableLeave = () => hideTooltip();
(window as G).handlePaneSearch   = (kind: string, value: string) => {
    if (kind === 'prefix' || kind === 'suffix') {
        paneFilters[kind] = value;
        renderNotablePane(kind);
        syncPaneFilterInputs();
    }
};
(window as G).handleAdvancedMode = (checked: boolean) => {
    advancedMode = checked;
    // Do NOT reset slots, activeSlot, paneFilters, or activeTagFilters
    render();
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    atlasImage = new Image();
    const atlasLoaded = new Promise<void>(resolve => {
        atlasImage!.onload  = () => { _svgAtlasCache.clear(); resolve(); };
        atlasImage!.onerror = () => resolve();
    });
    atlasImage.src = './media/atlas.png';

    const [largeRes, mediumRes, smallRes, notableIdsRes] = await Promise.all([
        fetch('./data/large_cluster_types.json'),
        fetch('./data/medium_cluster_types.json'),
        fetch('./data/small_cluster_types.json'),
        fetch('./data/notable_ids.json'),
    ]);

    allData.large  = await largeRes.json()  as Record<string, ClusterType>;
    allData.medium = await mediumRes.json() as Record<string, ClusterType>;
    allData.small  = await smallRes.json()  as Record<string, ClusterType>;
    notableIds     = await notableIdsRes.json() as Record<string, NotableIdEntry>;

    data = allData.large;
    await atlasLoaded;

    const jewelTypeSel    = document.getElementById('jewelTypeSelect') as HTMLSelectElement;
    const clusterSel      = document.getElementById('clusterSelect')   as HTMLSelectElement;
    const advancedCheckbox = document.getElementById('advancedMode')   as HTMLInputElement;

    populateClusterSelect();
    renderSvgLayout();

    jewelTypeSel.addEventListener('change', () => {
        currentJewelSize = jewelTypeSel.value as JewelSize;
        data = allData[currentJewelSize];
        activeTagFilters.clear();
        populateClusterSelect();
        renderSvgLayout();
        render();
    });

    clusterSel.addEventListener('change', () => {
        activeTagFilters.clear();
        render();
    });

    advancedCheckbox.addEventListener('change', () => {
        advancedMode = advancedCheckbox.checked;
        render();
    });

    render();
});