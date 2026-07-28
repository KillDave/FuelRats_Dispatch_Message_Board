interface CopyableSystemProps {
  system: string;
  className?: string;
}

/**
 * A system name that copies itself to the clipboard when clicked.
 *
 * stopPropagation matters: case cards are themselves clickable, so without it
 * copying a system would also select or expand the case underneath.
 */
export function CopyableSystem({ system, className = '' }: CopyableSystemProps) {
  if (!system) return <span className={className}>{system}</span>;

  const copy = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(system);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      title="Click to copy system name"
      onClick={copy}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') copy(e); }}
      className={`cursor-pointer hover:text-orange-300 transition-colors ${className}`}
    >
      {system}
    </span>
  );
}
