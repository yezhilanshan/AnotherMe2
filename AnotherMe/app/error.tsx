'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    console.error('App Error:', error);
  }, [error]);

  return (
    <div className="min-h-mobile-screen flex flex-col items-center justify-center bg-gray-50 p-4 pb-safe">
      <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">页面出错了</h2>
        <p className="text-sm text-gray-500 break-all">
          {isDev ? error.message || '发生了一些意外错误' : '系统繁忙，请稍后重试。'}
        </p>
        <button
          onClick={() => reset()}
          className="mt-6 w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
        >
          尝试恢复
        </button>
      </div>
    </div>
  );
}
