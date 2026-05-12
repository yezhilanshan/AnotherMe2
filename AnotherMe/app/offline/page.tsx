import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata = {
  title: '离线 - 镜我',
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-mobile-screen items-center justify-center px-4 py-10 pb-safe">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <WifiOff className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold">当前处于离线状态</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          网络恢复后刷新页面，即可继续访问课堂、笔记和 AI 导师内容。
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
