import { reactive, ref, type Ref } from 'vue';

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const READABLE_SCALE = 0.45;

const clamp = (value: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/**
 * Drag to pan, wheel or pinch to zoom, for mouse and touch alike (pointer
 * events), on the element `container` points at.
 */
export const usePanZoom = (container: Ref<HTMLElement | null>) => {
  const transform = reactive<Transform>({ x: 0, y: 0, scale: 1 });
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let moved = false;
  /** A finger or the mouse is down: the map layer is kept composited while it is. */
  const gesturing = ref(false);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = container.value?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = clamp(transform.scale * factor);
    const ratio = scale / transform.scale;
    transform.x = px - (px - transform.x) * ratio;
    transform.y = py - (py - transform.y) * ratio;
    transform.scale = scale;
  };

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = false;
    gesturing.value = true;
    if (pointers.size === 2) pinchDistance = distance();
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, current);
    if (pointers.size === 1) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (moved) {
        container.value?.setPointerCapture(event.pointerId);
        transform.x += dx;
        transform.y += dy;
      }
    } else if (pointers.size === 2) {
      moved = true;
      const next = distance();
      const [a, b] = [...pointers.values()];
      if (a && b && pinchDistance > 0)
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, next / pinchDistance);
      pinchDistance = next;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) gesturing.value = false;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomAt(
      event.clientX,
      event.clientY,
      Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))
    );
  };

  /**
   * Fits the whole graph, but never below a zoom where cards stay readable;
   * a graph too big for that opens at its top-left corner, where it starts.
   */
  const fit = (width: number, height: number) => {
    const rect = container.value?.getBoundingClientRect();
    if (!rect || width === 0 || height === 0) return;
    const fitted = Math.min(
      (rect.width - 32) / width,
      (rect.height - 32) / height,
      1
    );
    const scale = clamp(Math.max(fitted, READABLE_SCALE));
    transform.scale = scale;
    transform.x = Math.max(16, (rect.width - width * scale) / 2);
    transform.y = Math.max(16, (rect.height - height * scale) / 2);
  };

  /**
   * Brings a box (graph coordinates) into view at a readable zoom, near the
   * edge the map flows from: the left on a wide screen, the top on a phone,
   * where layouts run top to bottom.
   */
  const centerOn = (
    box: { x: number; y: number; width: number; height: number },
    scale = 0.75
  ) => {
    const rect = container.value?.getBoundingClientRect();
    if (!rect) return;
    transform.scale = clamp(scale);
    if (rect.width < rect.height) {
      transform.x = rect.width / 2 - (box.x + box.width / 2) * transform.scale;
      transform.y = 56 - box.y * transform.scale;
    } else {
      transform.x = 48 - box.x * transform.scale;
      transform.y =
        rect.height / 2 - (box.y + box.height / 2) * transform.scale;
    }
  };

  /** True when the last pointer gesture panned or zoomed, so it shouldn't count as a click. */
  const wasDrag = () => moved;

  return {
    transform,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    fit,
    centerOn,
    wasDrag,
    zoomAt,
    gesturing,
  };
};
