// MathJax 渲染队列 — 避免流式结束时所有公式同时渲染阻塞主线程
// 每次最多并发 MAX_CONCURRENT 个 MathJax 实例，其余排队等待

const MAX_CONCURRENT = 2;
let running = 0;
const queue: Array<() => void> = [];

function processNext() {
  if (queue.length === 0 || running >= MAX_CONCURRENT) return;
  running++;
  const resolve = queue.shift()!;
  resolve();
}

/**
 * 请求渲染槽位。返回 Promise，resolve 时说明轮到此公式渲染。
 * 渲染完成后必须调用 releaseSlot()。
 */
export function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    queue.push(resolve);
    processNext();
  });
}

/** 释放渲染槽位，让排队的下一个公式开始渲染 */
export function releaseSlot() {
  running = Math.max(0, running - 1);
  processNext();
}
