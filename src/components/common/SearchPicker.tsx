import { useMemo, useState } from 'react';
import { Combobox, Option, tokens } from '@fluentui/react-components';

export interface PickerItem {
  id: string;
  label: string;
  secondary?: string;
}

/** Searchable picker for long lists (target projects, bookable resources) */
export function SearchPicker({
  items, value, onChange, placeholder, clearLabel, ariaLabel, width = 280,
}: {
  items: PickerItem[];
  value?: string;
  onChange: (id: string | undefined) => void;
  placeholder?: string;
  clearLabel?: string;
  ariaLabel?: string;
  width?: number;
}) {
  const selected = items.find(i => i.id === value);
  const [query, setQuery] = useState<string>();
  const shown = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const list = q ? items.filter(i => i.label.toLowerCase().includes(q) || i.secondary?.toLowerCase().includes(q)) : items;
    return list.slice(0, 60);
  }, [items, query]);

  return (
    <Combobox
      aria-label={ariaLabel}
      style={{ minWidth: width, maxWidth: width }}
      placeholder={placeholder}
      value={query ?? selected?.label ?? ''}
      selectedOptions={value ? [value] : []}
      onChange={e => setQuery(e.target.value)}
      onBlur={() => setQuery(undefined)}
      onOptionSelect={(_, d) => {
        setQuery(undefined);
        onChange(d.optionValue === '__clear' ? undefined : d.optionValue);
      }}
    >
      {clearLabel && <Option value="__clear" text={clearLabel}>{clearLabel}</Option>}
      {shown.map(i => (
        <Option key={i.id} value={i.id} text={i.label}>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{i.label}</span>
            {i.secondary && <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>{i.secondary}</span>}
          </span>
        </Option>
      ))}
      {!shown.length && <Option value="__none" text="" disabled>No matches</Option>}
    </Combobox>
  );
}
