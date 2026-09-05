/**
 * 通用拖拽：按住 handle 拖动 box（两者都基于 position: fixed 的 shadow DOM 组件）。
 * 开始拖时把 right/bottom 锚定转换为 left/top，拖动过程限制在视口内。
 */
export function attachDrag(handle: HTMLElement, box: HTMLElement): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const clamp = (v: number, min: number, max: number): number =>
    Math.min(Math.max(v, min), max);

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // 让按钮/输入等交互元素保持可点击，拖拽只发生在空白标题区
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, label, [role="button"]')) return;
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    // 转为 left/top 定位，避免 right/bottom 锚定干扰
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    startX = e.clientX;
    startY = e.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    dragging = true;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const rect = box.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width - 4);
    const maxY = Math.max(0, window.innerHeight - rect.height - 4);
    box.style.left = `${clamp(originLeft + (e.clientX - startX), 0, maxX)}px`;
    box.style.top = `${clamp(originTop + (e.clientY - startY), 0, maxY)}px`;
  };

  const onUp = (e: PointerEvent): void => {
    dragging = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}
