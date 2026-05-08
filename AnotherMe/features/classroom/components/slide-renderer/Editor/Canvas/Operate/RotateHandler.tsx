interface RotateHandlerProps {
  readonly style?: React.CSSProperties;
  readonly className?: string;
  readonly onMouseDown?: (e: React.MouseEvent | React.TouchEvent) => void;
  readonly onTouchStart?: (e: React.TouchEvent) => void;
}

export function RotateHandler({ style, className, onMouseDown, onTouchStart }: RotateHandlerProps) {
  return (
    <div
      className={`rotate-handler absolute w-[10px] h-[10px] -top-[25px] -ml-[5px] border border-primary bg-white rounded-[1px] cursor-grab active:cursor-grabbing touch-none ${className || ''}`}
      style={{
        minWidth: '44px',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    />
  );
}
