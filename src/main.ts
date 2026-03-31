const IMAGE_BASE = 'https://image.ggpk.exposed/poe1/';

const SLOT_COLOR = ['#ff0000', '#00ff00', '#ffff00'] as const;

interface Notable {
    name: string;
    id: number;
    kind: 'prefix' | 'suffix';
    clusterKey: string;
    icon: string;
}

interface ClusterType {
    prefix_notables: { name: string; id: number }[];
    suffix_notables: { name: string; id: number }[];
    icon: string;
    small_passive_stats: string[];
}

let data: Record<string, ClusterType> = {};
let slots: [Notable | null, Notable | null, Notable | null] = [null, null, null];
let activeSlot: 0 | 1 | 2 = 0;

const prettyKey = (k: string): string =>
    k.replace('affliction_', '').replace(/_/g, ' ');

const imgUrl = (icon: string): string => IMAGE_BASE + icon.replace(/\.png$/i, '.dds');

function getAllNotablesForCluster(clusterKey: string): Notable[] {
    const ct = data[clusterKey];
    return [
        ...ct.prefix_notables.map(n => ({ ...n, kind: 'prefix' as const, clusterKey, icon: ct.icon })),
        ...ct.suffix_notables.map(n => ({ ...n, kind: 'suffix' as const, clusterKey, icon: ct.icon })),
    ].sort((a, b) => a.id - b.id);
}

function currentClusterKey(): string {
    return (document.getElementById('clusterSelect') as HTMLSelectElement).value;
}

function notablesForSvgPositions(): [Notable | null, Notable | null, Notable | null] {
    const filled = slots.filter((n): n is Notable => n !== null).sort((a, b) => a.id - b.id);
    if (filled.length === 0) return [null, null, null];
    if (filled.length === 1) return [filled[0], null, null];
    if (filled.length === 2) return [null, filled[0], filled[1]];
    return [filled[1], filled[0], filled[2]];
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
    if (notable.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1) return;
    if (notable.kind === 'prefix' && kindCount('prefix', activeSlot) >= 2) return;
    if (slots.some((n, i) => i !== activeSlot && n?.id === notable.id)) return;
    slots[activeSlot] = notable;
    const next = ([0, 1, 2] as const).find(i => i > activeSlot && slots[i] === null && slotAvailable(i));
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
    if (i === 0) return true;
    if (i === 1) return slots[0] !== null;
    return slots[0] !== null && slots[1] !== null;
}

function setActiveSlot(i: 0 | 1 | 2): void {
    if (!slotAvailable(i)) return;
    activeSlot = i;
    render();
}

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

function renderSlotHeaders(): void {
    const container = document.getElementById('slotHeaders') as HTMLElement;
    container.innerHTML = ([0, 1, 2] as const).map(i => {
        const n = slots[i];
        const isActive = i === activeSlot;
        const available = slotAvailable(i);
        const dotColor = n ? SLOT_COLOR[i] : null;
        let cls = 'slot-card';
        if (isActive) cls += ' active';
        if (!available) cls += ' locked';
        return `<div class="${cls}" onclick="handleSlotClick(${i})">
  <div class="slot-num ${isActive ? 'active' : ''}">${i + 1}</div>
  <div class="slot-content">
    ${!available
            ? `<span class="slot-locked">select slot ${i} first</span>`
            : n
                ? `<div class="slot-icon-wrap">
           <img class="slot-icon" src="${imgUrl(n.icon)}" alt="" />
           ${dotColor ? `<span class="pos-dot" style="background:${dotColor}"></span>` : ''}
         </div>
         <div class="slot-text">
           <div class="slot-name">${n.name}</div>
           <div class="slot-meta">${n.kind} &middot; ${n.id} &middot; ${prettyKey(n.clusterKey)}</div>
         </div>
         <button class="slot-clear" onclick="event.stopPropagation();handleClearSlot(${i})">✕</button>`
                : `<span class="slot-empty">empty — click to select</span>`
        }
  </div>
</div>`;
    }).join('');
}

function renderNotableList(): void {
    const clusterKey = currentClusterKey();
    const all = getAllNotablesForCluster(clusterKey);

    const placedIds = slots.filter((n): n is Notable => n !== null).map(n => n.id).sort((a, b) => a - b);
    const loId = placedIds.length >= 2 ? placedIds[0] : null;
    const hiId = placedIds.length >= 2 ? placedIds[placedIds.length - 1] : null;
    const isInWindow = (n: Notable) => loId !== null && hiId !== null && n.id > loId && n.id < hiId;

    const currentKind   = slots[activeSlot]?.kind;
    const suffixBlocked = (n: Notable) => n.kind === 'suffix' && kindCount('suffix', activeSlot) >= 1 && currentKind !== 'suffix';
    const prefixBlocked = (n: Notable) => n.kind === 'prefix' && kindCount('prefix', activeSlot) >= 2 && currentKind !== 'prefix';

    const windowInfo = document.getElementById('windowInfo') as HTMLElement;
    const windowCount = all.filter(n => isInWindow(n) && n.kind === 'prefix').length;
    windowInfo.textContent = loId !== null && hiId !== null
        ? `${windowCount} prefix notable${windowCount !== 1 ? 's' : ''} land between IDs ${loId}–${hiId}`
        : 'Select 2 notables to calculate the valid window';

    const isSlot3 = activeSlot === 2;
    const outOfWindow = (n: Notable) =>
        isSlot3 && loId !== null && hiId !== null && (n.id <= loId || n.id >= hiId);

    const list = document.getElementById('notableList') as HTMLElement;
    list.innerHTML = all.map(n => {
        const isThisSlot  = slots[activeSlot]?.id === n.id;
        const isOtherSlot = !isThisSlot && slots.some(s => s?.id === n.id);
        const impossible  = !isThisSlot && !isOtherSlot && outOfWindow(n);
        const isBlocked   = !isThisSlot && (suffixBlocked(n) || prefixBlocked(n) || impossible);
        const inWindow    = isInWindow(n) && n.kind === 'prefix';
        const clickable   = !isOtherSlot && !isBlocked;
        const usedInSlot  = slots.findIndex(s => s?.id === n.id);

        const placedSlot = slots.findIndex(s => s?.id === n.id);
        const dotColor = placedSlot !== -1 ? SLOT_COLOR[placedSlot] : null;

        let cls = 'notable-item';
        if (isThisSlot)       cls += ' is-selected';
        else if (isOtherSlot) cls += ' is-used';
        else if (isBlocked)   cls += ' is-blocked';
        else if (inWindow)    cls += ' in-window';
        if (clickable)        cls += ' clickable';

        return `<div class="${cls}" ${clickable ? `onclick="handleNotableClick('${clusterKey}',${n.id})"` : ''}>
  <div class="ni-left">
    ${dotColor ? `<span class="ni-pos-dot" style="background:${dotColor};box-shadow:0 0 4px ${dotColor}88"></span>` : '<span class="ni-pos-dot empty"></span>'}
    <img class="ni-icon" src="${imgUrl(n.icon)}" alt="" />
  </div>
  <div class="ni-body">
    <span class="ni-name">${n.name}</span>
    <span class="ni-kind ${n.kind}">${n.kind}</span>
  </div>
  <div class="ni-right">
    ${inWindow ? '<span class="fits-tag">fits</span>' : ''}
    ${impossible ? '<span class="blocked-tag">impossible</span>' : isBlocked ? `<span class="blocked-tag">${n.kind === 'suffix' ? 'suffix taken' : 'prefix limit'}</span>` : ''}
    ${isOtherSlot ? `<span class="used-tag">slot ${usedInSlot + 1}</span>` : ''}
    <span class="ni-id">${n.id}</span>
  </div>
</div>`;
    }).join('');
}

function render(): void {
    renderSvg();
    renderSlotHeaders();
    renderNotableList();
}

type G = Window & typeof globalThis & Record<string, unknown>;
(window as G).handleSlotClick = (i: number) => setActiveSlot(i as 0 | 1 | 2);
(window as G).handleClearSlot = (i: number) => clearSlot(i as 0 | 1 | 2);
(window as G).handleNotableClick = (clusterKey: string, id: number) => {
    const notable = getAllNotablesForCluster(clusterKey).find(n => n.id === id);
    if (notable) selectNotable(notable);
};

document.addEventListener('DOMContentLoaded', async () => {
    const res = await fetch('./large_cluster_types.json');
    data = await res.json() as Record<string, ClusterType>;

    const sel = document.getElementById('clusterSelect') as HTMLSelectElement;
    Object.keys(data)
        .sort((a, b) => prettyKey(a).localeCompare(prettyKey(b)))
        .forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = prettyKey(k);
            sel.appendChild(o);
        });

    sel.addEventListener('change', render);
    render();
});