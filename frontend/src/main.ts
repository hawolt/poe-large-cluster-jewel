const IMAGE_BASE = 'https://image.ggpk.exposed/poe1/';

const SLOT_COLOR = ['#ff0000', '#00ff00', '#ffff00'] as const;

type JewelSize = 'large' | 'medium' | 'small';

interface Notable {
    name: string;
    id: number;
    kind: 'prefix' | 'suffix';
    clusterKey: string;
    jewelSize: JewelSize;
    icon: string;
}

interface ClusterType {
    prefix_notables: { name: string; id: number }[];
    suffix_notables: { name: string; id: number }[];
    icon: string;
    small_passive_stats: string[];
}

const allData: Record<JewelSize, Record<string, ClusterType>> = {
    large: {},
    medium: {},
    small: {},
};

let data: Record<string, ClusterType> = {};
let slots: [Notable | null, Notable | null, Notable | null] = [null, null, null];
let activeSlot: 0 | 1 | 2 = 0;
let currentJewelSize: JewelSize = 'large';

const MAX_SLOTS: Record<JewelSize, number>  = { large: 3, medium: 2, small: 1 };
const MAX_PREFIX: Record<JewelSize, number> = { large: 2, medium: 2, small: 1 };

const prettyKey = (k: string): string => k.replace('affliction_', '').replace(/_/g, ' ');
const imgUrl    = (icon: string): string  => IMAGE_BASE + icon.replace(/\.png$/i, '.dds');

function getAllNotablesForCluster(clusterKey: string): Notable[] {
    const ct = data[clusterKey];
    return [
        ...ct.prefix_notables.map(n => ({ ...n, kind: 'prefix' as const, clusterKey, jewelSize: currentJewelSize, icon: ct.icon })),
        ...ct.suffix_notables.map(n => ({ ...n, kind: 'suffix' as const, clusterKey, jewelSize: currentJewelSize, icon: ct.icon })),
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
    return slots.filter((n, i) => n?.kind === kind && i !== exclude).length;
}

function selectNotable(notable: Notable): void {
    if (slots[activeSlot]?.id === notable.id) {
        slots[activeSlot] = null;
        render();
        return;
    }
    const maxPrefix = MAX_PREFIX[currentJewelSize];
    if (notable.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1) return;
    if (notable.kind === 'prefix' && kindCount('prefix', activeSlot) >= maxPrefix) return;
    if (slots.some((n, i) => i !== activeSlot && n?.id === notable.id)) return;
    slots[activeSlot] = notable;

    const maxSlots = MAX_SLOTS[currentJewelSize];
    const validSlots = ([0, 1, 2] as const).slice(0, maxSlots);
    const next = validSlots.find(i => i > activeSlot && slots[i] === null && slotAvailable(i));
    if (next !== undefined) activeSlot = next;
    render();
}

function clearSlot(i: 0 | 1 | 2): void {
    slots[i] = null;
    if (i === 0) { slots[1] = null; slots[2] = null; }
    if (i === 1) { slots[2] = null; }
    activeSlot = i;
    render();
}

function slotAvailable(i: 0 | 1 | 2): boolean {
    const maxSlots = MAX_SLOTS[currentJewelSize];
    if (i >= maxSlots) return false;
    if (i === 0) return true;
    if (i === 1) return slots[0] !== null;
    return slots[0] !== null && slots[1] !== null;
}

function setActiveSlot(i: 0 | 1 | 2): void {
    if (!slotAvailable(i)) return;
    slots[i] = null;
    if (i === 0) { slots[1] = null; slots[2] = null; }
    if (i === 1) { slots[2] = null; }
    activeSlot = i;
    render();
}

function isFractured(i: 0 | 1 | 2): boolean {
    const n = slots[i];
    if (!n) return false;
    return n.clusterKey !== currentClusterKey() || n.jewelSize !== currentJewelSize;
}

function updateSelectLocks(): void {
    // clusterSelect: lock after 2nd selection (all sizes)
    const clusterLocked = slots[1] !== null;
    (document.getElementById('clusterSelect') as HTMLSelectElement).disabled = clusterLocked;

    // jewelTypeSelect: always lock after the 1st selection regardless of size
    const jewelTypeLocked = slots[0] !== null;
    (document.getElementById('jewelTypeSelect') as HTMLSelectElement).disabled = jewelTypeLocked;
}

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

// ---------------------------------------------------------------------------
// SVG layout — geometry rebuilt per jewel size
// ---------------------------------------------------------------------------

/**
 * Coordinate space: viewBox "-150 -150 300 300", circle radius 100, centre (0,0).
 * Key points on radius-100 circle:
 *   top-middle    (0, -100)
 *   right-middle  (100, 0)
 *   bottom-middle (0,  100)
 *   left-middle   (-100, 0)
 *
 * Notable / socket images are 56×56 (centred: x = cx-28, y = cy-28).
 * Socket images are 52×52 (centred: x = cx-26, y = cy-26).
 * The top-connector line runs from the viewBox edge (0,-150) to the top of
 * the circle (0,-100), matching the large cluster layout.
 */
function renderSvgLayout(): void {
    const body = document.getElementById('jewel-svg-body') as Element;
    while (body.firstChild) body.removeChild(body.firstChild);

    if (currentJewelSize === 'large') {
        // Original layout: segmented full circle, 3 notables, 2 sockets, top connector
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
            <image x="-113" y="24" width="52" height="52" href="socket.png" opacity="1.0"/>
            <image x="61"   y="24" width="52" height="52" href="socket.png" opacity="1.0"/>
            <image id="svg-notable-icon1"    x="-28" y="72"  width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-28" y="72"  width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="0"   y="148" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="-115" y="-78" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="-115" y="-78" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="-87"  y="-95" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="59"  y="-78" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="59"  y="-78" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="87"  y="-95" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;

    } else if (currentJewelSize === 'medium') {
        // Full circle, unsegmented.
        // Top connector + empty passive node at (0,-100).
        // Socket at bottom-middle (0,100): image at (-26, 74).
        // Notable 1 at left-middle  (-100, 0): image at (-128, -28).
        // Notable 2 at right-middle (100,  0): image at (72,   -28).
        body.innerHTML = `
            <g fill="none" stroke-width="6" stroke="#444">
                <line x1="0" y1="-150" x2="0" y2="-100"/>
                <circle cx="0" cy="0" r="100" fill="none"/>
            </g>
            <g stroke="#333" fill="#2a2a2a">
                <circle cx="0" cy="-100" r="14"/>
            </g>
            <image x="-26" y="74" width="52" height="52" href="socket.png" opacity="1.0"/>
            <image id="svg-notable-icon1"    x="-128" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-128" y="-28" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="-100" y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="72"   y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="72"   y="-28" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="100"  y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="-28" y="-28" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;

    } else {
        // Small – left quarter-arc from top-middle down to bottom-middle.
        // Connector: (0,-150) → (0,-100) = top of the full circle.
        // Arc: M 0 -100 A 100 100 0 0 1 0 100
        //   sweep-flag=1 (clockwise), large-arc-flag=0 (short path)
        //   → traces the LEFT side of the circle: top → (-100,0) → bottom.
        // Empty passive node at left-middle (-100, 0).
        // Notable at bottom-middle (0, 100): image at (-28, 72).
        body.innerHTML = `
            <g fill="none" stroke-width="6" stroke="#444">
                <line x1="0" y1="-150" x2="0" y2="-100"/>
                <path d="M 0 -100 A 100 100 0 0 0 0 100"/>
            </g>
            <g stroke="#333" fill="#2a2a2a">
                <circle cx="-100" cy="0" r="14"/>
            </g>
            <image id="svg-notable-icon1"    x="-28" y="72" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay1" x="-28" y="72" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-red)"/>
            <text  id="svg-notable-label1"   x="0"   y="148" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon2"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay2" x="-28" y="-28" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-green)"/>
            <text  id="svg-notable-label2"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
            <image id="svg-notable-icon3"    x="-28" y="-28" width="56" height="56" href="" opacity="0"/>
            <image id="svg-notable-overlay3" x="-28" y="-28" width="56" height="56" href="./overlay.png" opacity="0" filter="url(#outline-blue)"/>
            <text  id="svg-notable-label3"   x="0"   y="-38" font-size="9" text-anchor="middle" fill="#bbb" opacity="0"></text>
        `;
    }
}

// ---------------------------------------------------------------------------
// Notable icon overlay rendering
// ---------------------------------------------------------------------------

const SLOT_FILTER = ['url(#outline-red)', 'url(#outline-green)', 'url(#outline-blue)'] as const;

function setSvgNotable(svgIndex: 1 | 2 | 3, n: Notable | null): void {
    const selectionSlot = n ? slots.findIndex(s => s?.id === n.id) : -1;
    const filter  = selectionSlot !== -1 ? SLOT_FILTER[selectionSlot] : 'url(#outline-red)';
    const icon    = document.getElementById(`svg-notable-icon${svgIndex}`);
    const overlay = document.getElementById(`svg-notable-overlay${svgIndex}`);
    const label   = document.getElementById(`svg-notable-label${svgIndex}`);
    if (icon) {
        icon.setAttribute('href', n ? imgUrl(n.icon) : '');
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

// ---------------------------------------------------------------------------
// Slot headers
// ---------------------------------------------------------------------------

function renderSlotHeaders(): void {
    const maxSlots = MAX_SLOTS[currentJewelSize];
    const container = document.getElementById('slotHeaders') as HTMLElement;
    const visibleSlots = ([0, 1, 2] as const).slice(0, maxSlots);
    container.innerHTML = visibleSlots.map(i => {
        const n = slots[i];
        const isActive = i === activeSlot;
        const available = slotAvailable(i);
        const dotColor = n ? SLOT_COLOR[i] : null;
        const fractured = isFractured(i);
        let cls = 'slot-card';
        if (isActive) cls += ' active';
        if (!available) cls += ' locked';
        if (fractured) cls += ' fractured';
        return `<div class="${cls}" onclick="handleSlotClick(${i})">
  <div class="slot-num ${isActive ? 'active' : ''}">${i + 1}</div>
  <div class="slot-content">
    ${!available
            ? `<span class="slot-locked">select ${i === 1 ? 'first' : 'second'} notable first</span>`
            : n
                ? `<div class="slot-icon-wrap">
           <img class="slot-icon" src="${imgUrl(n.icon)}" alt="" />
           ${dotColor ? `<span class="pos-dot" style="background:${dotColor}"></span>` : ''}
         </div>
         <div class="slot-text">
           <div class="slot-name">${n.name}</div>
           <div class="slot-meta"><span class="slot-meta-text">${n.kind} &middot; ${n.id} &middot; ${prettyKey(n.clusterKey)}</span>${fractured ? '<span class="fractured-tag">fractured</span>' : ''}</div>
         </div>
         <button class="slot-clear" onclick="event.stopPropagation();handleClearSlot(${i})">✕</button>`
                : `<span class="slot-empty">empty — click to select</span>`
        }
  </div>
</div>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Notable pane
// ---------------------------------------------------------------------------

function renderNotablePane(kind: 'prefix' | 'suffix'): void {
    const clusterKey = currentClusterKey();
    const all = getAllNotablesForCluster(clusterKey).filter(n => n.kind === kind);
    const isLarge = currentJewelSize === 'large';

    const placedIds = slots.filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const windowIds = [slots[0], slots[1]].filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const loId = windowIds.length >= 2 ? windowIds[0] : null;
    const hiId = windowIds.length >= 2 ? windowIds[1] : null;
    const isInWindow = (n: Notable) => loId !== null && hiId !== null && n.id > loId && n.id < hiId;
    const firstId = slots[0]?.id ?? null;
    const belowFirst = (n: Notable) =>
        activeSlot === 1 && slots[1] === null && firstId !== null && n.kind === 'prefix' && n.id < firstId;

    const currentKind   = slots[activeSlot]?.kind;
    const maxPrefix     = MAX_PREFIX[currentJewelSize];
    const suffixBlocked = (n: Notable) => n.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1 && currentKind !== 'suffix';
    const prefixBlocked = (n: Notable) => n.kind === 'prefix' && kindCount('prefix', activeSlot) >= maxPrefix && currentKind !== 'prefix';

    const isUndesired = (n: Notable): boolean => {
        if (!isLarge) return false; // only relevant for large
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
        const placedSlot  = slots.findIndex(s => s?.id === n.id);
        const dotColor    = placedSlot !== -1 ? SLOT_COLOR[placedSlot] : null;

        let cls = 'notable-item';
        if (isThisSlot)       cls += ' is-selected';
        else if (isOtherSlot) cls += ' is-used';
        else if (isBlocked)   cls += ' is-blocked';
        else if (inWindow)    cls += ' in-window';
        if (undesired)        cls += ' is-undesired';
        if (clickable)        cls += ' clickable';
        if (isVariant)        cls += ' is-variant';

        // Tags: desired/undesired/variant only shown for large
        const tags = isLarge
            ? (!isThisSlot && !isOtherSlot && inWindow   ? '<span class="desired-tag">desired</span>'   : '') +
            (!isThisSlot && !isOtherSlot && isVariant  ? '<span class="variant-tag">2-notable variant</span>' : '') +
            (!isThisSlot && !isOtherSlot && undesired  ? '<span class="undesired-tag">undesired</span>' : '')
            : '';

        return `<div class="${cls}" ${clickable ? `onclick="handleNotableClick('${clusterKey}',${n.id})"` : ''}>
  <div class="ni-left">
    <img class="ni-icon" src="${imgUrl(n.icon)}" alt="" />
    ${dotColor ? `<span class="ni-pos-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}88"></span>` : '<span class="ni-pos-dot empty"></span>'}
  </div>
  <div class="ni-main">
    <div class="ni-body">
      <span class="ni-name">${n.name}</span>
    </div>
    <div class="ni-right">
      ${tags}
      ${isBlocked && !isThisSlot && !isOtherSlot ? `<span class="blocked-tag">${n.kind === 'suffix' ? 'suffix taken' : 'prefix limit'}</span>` : ''}
      ${isOtherSlot ? `<span class="used-tag">selection ${usedInSlot + 1}</span>` : ''}
      <span class="ni-id">${n.id}</span>
    </div>
  </div>
</div>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Window info — large only
// ---------------------------------------------------------------------------

function renderWindowInfo(): void {
    const windowInfo = document.getElementById('windowInfo') as HTMLElement;

    if (currentJewelSize !== 'large') {
        windowInfo.textContent = '';
        return;
    }

    const clusterKey = currentClusterKey();
    const all = getAllNotablesForCluster(clusterKey);
    const placedIds = slots.filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const loId = placedIds.length >= 2 ? placedIds[0] : null;
    const hiId = placedIds.length >= 2 ? placedIds[placedIds.length - 1] : null;
    const isInWindow = (n: Notable) => loId !== null && hiId !== null && n.id > loId && n.id < hiId;
    const windowCount = all.filter(n => isInWindow(n) && n.kind === 'prefix').length;
    const firstPlaced = slots[0];
    const belowCount = firstPlaced && !slots[1]
        ? all.filter(n => n.kind === 'prefix' && n.id < firstPlaced.id).length
        : null;
    windowInfo.textContent = loId !== null && hiId !== null
        ? `${windowCount} prefix notable${windowCount !== 1 ? 's' : ''} land between IDs ${loId}–${hiId}`
        : belowCount !== null
            ? `${belowCount} prefix notable${belowCount !== 1 ? 's' : ''} can be the 2nd selection`
            : 'Select 2 notables to calculate the valid window';
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

function render(): void {
    renderSvg();
    renderSlotHeaders();
    renderWindowInfo();
    renderNotablePane('prefix');
    renderNotablePane('suffix');
    updateSelectLocks();
}

type G = Window & typeof globalThis & Record<string, unknown>;
(window as G).handleSlotClick    = (i: number) => setActiveSlot(i as 0 | 1 | 2);
(window as G).handleClearSlot    = (i: number) => clearSlot(i as 0 | 1 | 2);
(window as G).handleNotableClick = (clusterKey: string, id: number) => {
    const notable = getAllNotablesForCluster(clusterKey).find(n => n.id === id);
    if (notable) selectNotable(notable);
};

document.addEventListener('DOMContentLoaded', async () => {
    const [largeRes, mediumRes, smallRes] = await Promise.all([
        fetch('./data/large_cluster_types.json'),
        fetch('./data/medium_cluster_types.json'),
        fetch('./data/small_cluster_types.json'),
    ]);
    allData.large  = await largeRes.json()  as Record<string, ClusterType>;
    allData.medium = await mediumRes.json() as Record<string, ClusterType>;
    allData.small  = await smallRes.json()  as Record<string, ClusterType>;

    data = allData.large;

    const jewelTypeSel = document.getElementById('jewelTypeSelect') as HTMLSelectElement;
    const clusterSel   = document.getElementById('clusterSelect') as HTMLSelectElement;

    populateClusterSelect();
    renderSvgLayout();

    jewelTypeSel.addEventListener('change', () => {
        currentJewelSize = jewelTypeSel.value as JewelSize;
        data = allData[currentJewelSize];
        populateClusterSelect();
        renderSvgLayout();
        render();
    });

    clusterSel.addEventListener('change', () => render());

    render();
});