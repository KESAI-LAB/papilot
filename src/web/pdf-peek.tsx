import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { pdfPeekRegion, resolvePdfDestination } from './pdf-destination.ts';
import { t } from './i18n.ts';
import './pdf-peek.css';

type Target = {
  link: HTMLAnchorElement;
  document: PDFDocumentProxy;
  sourcePage: HTMLElement;
  href: string;
  annotationId: string | undefined;
  close: () => void;
};
type Size = { width: number; height: number; ratio: number };
const internalLink = (target: EventTarget | null) => target instanceof Element
  ? target.closest<HTMLAnchorElement>('.linkAnnotation[data-internal-link] a[href*="#"]') : null;
const redrawingLink = (link: HTMLAnchorElement) => Boolean(link.closest('.annotationLayer[hidden]'));

// PDF.js owns the links. Delegate gestures so lazily rendered/replaced
// annotation layers need no per-link handlers and ordinary clicks keep working.
export function PdfPeek({ container, document: pdf, disabled }: {
  container: RefObject<HTMLDivElement | null>; document: PDFDocumentProxy; disabled: boolean;
}) {
  const id = useId(), panel = useRef<HTMLDivElement>(null);
  const focusToRestore = useRef<HTMLAnchorElement | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const native = typeof HTMLElement.prototype.showPopover === 'function';
  useEffect(() => {
    setTarget(null);
    const box = container.current;
    if (!box || disabled) return;
    let active: HTMLAnchorElement | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let leaving: ReturnType<typeof setTimeout> | undefined, opened = false, displaced = false;
    let pointer: { x: number; y: number } | undefined;
    const recordPointer = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const stationary = (event: PointerEvent) => event.isTrusted && event.clientX === pointer?.x && event.clientY === pointer.y;
    const close = () => {
      clearTimeout(timer); clearTimeout(leaving); active = null; opened = false; displaced = false; focusToRestore.current = null;
      setTarget(null);
    };
    const open = (link: HTMLAnchorElement, immediate = false) => {
      clearTimeout(leaving);
      if (link === active && opened) return;
      close(); active = link;
      const show = () => {
        const sourcePage = link.closest<HTMLElement>('.page');
        if (active === link && sourcePage && box.contains(link)) {
          opened = true;
          setTarget({ link, document: pdf, sourcePage, href: link.href, annotationId: link.dataset.elementId, close });
        }
      };
      if (immediate) show(); else timer = setTimeout(show, 400);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      const link = internalLink(event.target);
      if (link && !(displaced && stationary(event) && link !== active)) {
        recordPointer(event);
        displaced = false;
        open(link);
      }
    };
    const within = (node: EventTarget | null) => node instanceof Node && (active?.contains(node) || panel.current?.contains(node));
    const depart = () => {
      clearTimeout(timer); clearTimeout(leaving);
      // A small bridge lets the pointer enter the preview without flicker.
      leaving = setTimeout(close, 100);
    };
    const out = (event: PointerEvent) => {
      if (!active || !within(event.target) || within(event.relatedTarget)) return;
      // Scrolling and a PDF.js redraw can move the link from under a still
      // pointer. Wait for a mouse move before treating this as a departure.
      if (opened && event.pointerType === 'mouse' && (redrawingLink(active) || (event.relatedTarget && stationary(event)))) {
        displaced = true;
        return;
      }
      depart();
    };
    const focus = (event: FocusEvent) => {
      const link = internalLink(event.target);
      if (link?.matches(':focus-visible')) open(link);
    };
    const blur = (event: FocusEvent) => {
      // PDF.js can briefly hide the same link during a zoom or fit update.
      if (event.relatedTarget === null && active === event.target && active && opened && redrawingLink(active)) {
        focusToRestore.current = active;
        return;
      }
      if (!within(event.relatedTarget)) close();
    };
    const click = (event: MouseEvent) => {
      const link = internalLink(event.target);
      if (link && event.button === 0 && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); open(link, true);
      } else close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const popup = panel.current!;
    const abort = new AbortController(), signal = abort.signal;
    box.addEventListener('pointerover', over, { signal });
    box.addEventListener('pointerout', out, { signal });
    box.addEventListener('focusin', focus, { signal });
    box.addEventListener('focusout', blur, { signal });
    box.addEventListener('click', click, { capture: true, signal });
    popup.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse') recordPointer(event);
      displaced = false;
      clearTimeout(leaving);
    }, { signal });
    popup.addEventListener('pointerleave', out, { signal });
    document.addEventListener('keydown', key, { capture: true, signal });
    document.addEventListener('focusin', event => { if (opened && !within(event.target)) close(); }, { capture: true, signal });
    document.addEventListener('pointerdown', event => { if (!within(event.target)) close(); }, { capture: true, signal });
    document.addEventListener('pointermove', event => {
      if (!active || event.pointerType !== 'mouse') return;
      if (displaced && !stationary(event)) {
        displaced = false;
        if (!within(event.target)) depart();
      }
      recordPointer(event);
    }, { passive: true, signal });
    window.addEventListener('blur', close, { signal });
    return () => { abort.abort(); clearTimeout(timer); clearTimeout(leaving); };
  }, [container, pdf, disabled]);

  const shown = !disabled && target?.document === pdf ? target : null;
  useLayoutEffect(() => {
    const element = panel.current!, box = container.current;
    if (!shown || !box) return;
    const { link, sourcePage, href, annotationId, close } = shown;
    const viewport = window.visualViewport;
    let frame = 0, measuredSize: Size | undefined, viewportHeight = 0;
    let movement: IntersectionObserver | undefined, observedBounds = '';
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const place = () => {
      frame = 0;
      if (!box.contains(link) || link.closest('.page') !== sourcePage || internalLink(link) !== link
        || link.href !== href || link.dataset.elementId !== annotationId) {
        close();
        return false;
      }

      const margin = 8;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight);
      const rect = link.getBoundingClientRect(), view = box.getBoundingClientRect(), page = sourcePage.getBoundingClientRect();
      const viewLeft = Math.max(left, view.left + box.clientLeft, page.left);
      const viewTop = Math.max(top, view.top + box.clientTop, page.top);
      const viewRight = Math.min(right, view.left + box.clientLeft + box.clientWidth, page.right);
      const viewBottom = Math.min(bottom, view.top + box.clientTop + box.clientHeight, page.bottom);
      if (redrawingLink(link) && viewLeft < viewRight && viewTop < viewBottom) {
        element.style.visibility = 'hidden';
        return true;
      }
      const anchorLeft = Math.max(viewLeft, rect.left), anchorRight = Math.min(viewRight, rect.right);
      const anchorTop = Math.max(viewTop, rect.top), anchorBottom = Math.min(viewBottom, rect.bottom);
      const above = anchorTop - top - 2 * margin, below = bottom - anchorBottom - 2 * margin;
      const width = Math.floor(Math.min(560, right - left - 2 * margin));
      // Retain the current crop if it still fits on either side. Resize when
      // it runs out of room or the visual viewport itself changes size.
      const preferredHeight = measuredSize?.width === width && viewportHeight === bottom - top ? measuredSize.height : 360;
      const height = Math.floor(Math.min(preferredHeight, Math.max(above, below)));
      viewportHeight = bottom - top;
      if (anchorLeft >= anchorRight || anchorTop >= anchorBottom || getComputedStyle(link).visibility !== 'visible'
        || height < 48 || width <= 2) {
        close();
        return false;
      }

      const x = Math.max(left + margin, Math.min(anchorLeft, right - width - margin));
      const y = below >= height ? anchorBottom + margin : anchorTop - height - margin;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (measuredSize?.width !== width || measuredSize.height !== height || measuredSize.ratio !== ratio) {
        measuredSize = { width, height, ratio };
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        setSize(measuredSize);
      }
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = '';
      if (focusToRestore.current === link) {
        focusToRestore.current = null;
        if (document.activeElement === document.body) link.focus({ preventScroll: true });
      }

      // An intersection with a tight root notices position changes even when
      // neither the link nor any observed box has changed size.
      const root = document.documentElement;
      const bounds = [
        -Math.floor(anchorTop), Math.ceil(anchorRight) - root.clientWidth,
        Math.ceil(anchorBottom) - root.clientHeight, -Math.floor(anchorLeft),
      ].map(value => `${value}px`).join(' ');
      if (observedBounds !== bounds) {
        observedBounds = bounds;
        movement?.disconnect();
        const threshold = (anchorRight - anchorLeft) * (anchorBottom - anchorTop) / (rect.width * rect.height);
        movement = new IntersectionObserver(schedule, { rootMargin: bounds, threshold: Math.min(threshold, 1) });
        movement.observe(link);
      }
      return true;
    };
    if (!place()) return;
    if (native) element.showPopover();
    const previous = link.getAttribute('aria-describedby');
    link.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));

    const abort = new AbortController(), signal = abort.signal;
    document.addEventListener('scroll', schedule, { capture: true, passive: true, signal });
    window.addEventListener('resize', schedule, { signal });
    viewport?.addEventListener('resize', schedule, { signal });
    viewport?.addEventListener('scroll', schedule, { signal });
    const resize = new ResizeObserver(schedule);
    resize.observe(box);
    resize.observe(sourcePage);
    resize.observe(link);
    const mutations = new MutationObserver(schedule);
    mutations.observe(box, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'href', 'data-internal-link', 'data-element-id'],
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      movement?.disconnect();
      mutations.disconnect();
      if (previous === null) link.removeAttribute('aria-describedby'); else link.setAttribute('aria-describedby', previous);
      if (native && element.matches(':popover-open')) element.hidePopover();
    };
  }, [shown, container, native, id]);

  return <div ref={panel} id={id} className="pdf-peek" popover={native ? 'manual' : undefined} hidden={!shown} role="tooltip">
    {shown && size && <PeekContent key={shown.href + ':' + shown.annotationId} target={shown} size={size}/>}
  </div>;
}

type Preview = {
  pageNumber: number;
  page: PDFPageProxy;
  destination: unknown[];
  content: Awaited<ReturnType<PDFPageProxy['getTextContent']>> | null;
};

function PeekContent({ target, size }: { target: Target; size: Size }) {
  const [result, setResult] = useState<{ target: Target; preview: Preview | null }>();
  const label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const source = await target.document.getPage(Number(target.sourcePage.dataset.pageNumber));
      const annotations = await source.getAnnotations({ intent: 'display' });
      const destination = annotations.find(annotation => annotation.id === target.annotationId)?.dest;
      if (!destination) throw new Error('Missing PDF destination');
      const resolved = await resolvePdfDestination(target.document, destination);
      if (!resolved) throw new Error('Invalid PDF destination');
      const page = await target.document.getPage(resolved.pageNumber);
      const content = await page.getTextContent().catch(() => null);
      if (!cancelled) setResult({ target, preview: { pageNumber: resolved.pageNumber, page, destination: resolved.explicit, content } });
    })().catch(() => { if (!cancelled) setResult({ target, preview: null }); });
    return () => { cancelled = true; };
  }, [target]);
  const preview = result?.target === target ? result.preview : undefined;
  return <>
    <div ref={label} className="pdf-peek-label">{preview ? t('Page {page}', { page: preview.pageNumber }) : t('Preview')}</div>
    {preview
      ? <PeekExcerpt preview={preview} size={size} label={label}/>
      : <div className="pdf-peek-message">{preview === null ? t('Preview unavailable') : t('Loading…')}</div>}
  </>;
}

function PeekExcerpt({ preview, size, label }: { preview: Preview; size: Size; label: RefObject<HTMLDivElement | null> }) {
  const excerpt = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false, render: RenderTask | undefined;
    void (async () => {
      const holder = excerpt.current!, element = holder.parentElement!;
      const { page, destination, content } = preview;
      const { ratio } = size;
      // Keep the last crop visible during a resize. A fresh canvas also
      // isolates the replacement from a cancelled PDF.js render.
      const output = document.createElement('canvas');
      const region = pdfPeekRegion(page, destination, element.clientWidth, element.clientHeight - label.current!.offsetHeight, content);
      output.width = Math.ceil(region.width * ratio); output.height = Math.ceil(region.height * ratio);
      output.style.width = `${region.width}px`; output.style.height = `${region.height}px`;
      render = page.render({ canvas: output, viewport: region.viewport, transform: [ratio, 0, 0, ratio, -region.left * ratio, -region.top * ratio] });
      await render.promise;
      if (cancelled) return;
      // Supply the excerpt to assistive technology without a live announcement
      // each time the pointer crosses a link.
      const text = content?.items.flatMap(item => {
        if (!('str' in item)) return [];
        const [x, y] = region.viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return x + item.width * region.viewport.scale >= region.left && x <= region.left + region.width && y >= region.top && y <= region.top + region.height ? [item.str] : [];
      }).join(' ');
      output.setAttribute('role', 'img');
      output.setAttribute('aria-label', text || t('Preview'));
      holder.replaceChildren(output);
      setStatus('ready');
    })().catch(() => {
      if (!cancelled && !excerpt.current?.firstChild) setStatus('error');
    });
    return () => { cancelled = true; render?.cancel(); };
  }, [preview, size, label]);
  return <>
    <div ref={excerpt}/>
    {status !== 'ready' && <div className="pdf-peek-message">{status === 'error' ? t('Preview unavailable') : t('Loading…')}</div>}
  </>;
}
