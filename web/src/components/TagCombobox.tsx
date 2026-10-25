import { X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';
import { addTokens, optionLookup, parseTokens, rankMatches, removeToken, splitMatch, tokenKey } from './tokenInput';
import './tag-combobox.css';

interface TagComboboxProps {
  label: string;
  values: string[];
  /** Suggestions, usually the catalog's loaded filter options. */
  options: string[];
  onChange: (values: string[]) => void;
  /** "tag" or "genre": used in the placeholder, empty state and announcements. */
  noun?: string;
  placeholder?: string;
  /** Accept values that are not in `options` (tags). Genres are a closed list, so they reject. */
  allowCustom?: boolean;
  /** Colours the chips: green for required values, red for excluded ones. */
  tone?: 'include' | 'exclude';
  /** Most suggestions rendered at once. */
  limit?: number;
}

/**
 * Multi-value picker with removable chips and a suggestion list (ARIA combobox, list autocomplete).
 * Typed or pasted comma-separated text is split into values; matching ignores case.
 */
export function TagCombobox({
  label,
  values,
  options,
  onChange,
  noun = 'tag',
  placeholder,
  allowCustom = true,
  tone,
  limit = 40,
}: TagComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);

  const lookup = useMemo(() => optionLookup(options), [options]);
  const suggestions = useMemo(
    () => rankMatches(options, text, values, limit),
    [options, text, values, limit],
  );
  const draft = text.trim();
  const draftKey = tokenKey(text);
  const offerCustom = allowCustom && Boolean(draft) && !lookup.has(draftKey) && !values.some((value) => tokenKey(value) === draftKey);
  const rows = offerCustom ? [...suggestions, draft] : suggestions;
  const customIndex = offerCustom ? suggestions.length : -1;
  const optionId = (index: number) => `${id}-opt-${index}`;
  const openCount = open ? rows.length : 0;

  const commit = (tokens: string[]) => {
    const result = addTokens(values, tokens, { lookup, allowCustom });
    if (result.added.length) onChange(result.values);
    const notes: string[] = [];
    if (result.added.length) notes.push(`Added ${result.added.join(', ')}`);
    if (result.rejected.length) notes.push(`Not a known ${noun}: ${result.rejected.join(', ')}`);
    setMessage(notes.join('. '));
    setUnknown(result.rejected);
    setText('');
    setActive(-1);
    return result;
  };

  const remove = (value: string) => {
    onChange(removeToken(values, value));
    setMessage(`Removed ${value}`);
    setUnknown([]);
  };

  const pick = (index: number) => {
    const value = rows[index];
    if (value === undefined) return;
    commit([value]);
    setOpen(false);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setMessage('');
    setUnknown([]);
    if (/[,\n\r]/.test(next)) {
      // Pasted or typed list: take every piece, leave nothing behind.
      commit(parseTokens(next));
      setOpen(false);
      return;
    }
    setText(next);
    setOpen(true);
    setActive(next.trim() ? 0 : -1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter and comma inside an IME composition confirm the candidate, not the filter value.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(rows.length ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : -1);
          break;
        }
        if (!rows.length) break;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => (current < 0 ? (step > 0 ? 0 : rows.length - 1) : (current + step + rows.length) % rows.length));
        break;
      }
      case 'Enter':
        if (open && active >= 0 && active < rows.length) {
          event.preventDefault();
          pick(active);
        } else if (draft) {
          event.preventDefault();
          commit([draft]);
          setOpen(false);
        }
        break;
      case ',':
        if (draft) {
          event.preventDefault();
          commit([draft]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setActive(-1);
        } else if (text) {
          event.preventDefault();
          event.stopPropagation();
          setText('');
        }
        break;
      case 'Backspace':
        if (!text && values.length) {
          event.preventDefault();
          remove(values[values.length - 1]);
        }
        break;
      default:
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
    setOpen(false);
    setActive(-1);
    // Only a complete, known name is taken on blur; half-typed text stays for the user to finish or clear.
    if (draft && lookup.has(draftKey)) commit([draft]);
  };

  const activeId = open && active >= 0 && active < rows.length ? optionId(active) : undefined;
  const inputId = `${id}-input`;
  const empty = open && !rows.length;

  return (
    <div className="token-combobox" data-tone={tone} ref={rootRef} onBlur={handleBlur}>
      <label className="token-combobox-label" htmlFor={inputId}>{label}</label>
      <div className="token-combobox-field" onClick={() => inputRef.current?.focus()}>
        {values.length > 0 && (
          <ul className="token-combobox-chips" aria-label={`Selected ${label.toLowerCase()}`}>
            {values.map((value) => (
              <li key={tokenKey(value)}>
                <span>{value}</span>
                <button type="button" aria-label={`Remove ${value} from ${label.toLowerCase()}`} onClick={(event) => { event.stopPropagation(); remove(value); inputRef.current?.focus(); }}>
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          placeholder={values.length ? '' : placeholder || `Type to search ${noun}s`}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="token-combobox-popup" onMouseDown={(event) => event.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`} hidden={!rows.length}>
            {rows.map((row, index) => {
              const [before, match, after] = index === customIndex ? [row, '', ''] : splitMatch(row, text);
              return (
                <li
                  key={`${index === customIndex ? 'custom:' : ''}${row}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={index === customIndex ? 'is-custom' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(index)}
                >
                  {index === customIndex ? (
                    <>Add &ldquo;{row}&rdquo;</>
                  ) : (
                    <>{before}{match && <mark>{match}</mark>}{after}</>
                  )}
                </li>
              );
            })}
          </ul>
          {empty && (
            <p className="token-combobox-empty">
              {options.length
                ? draft ? `No ${noun}s match “${draft}”.` : `All ${noun}s are already selected.`
                : `No ${noun} suggestions loaded.${allowCustom ? ' Type a name and press Enter.' : ''}`}
            </p>
          )}
        </div>
      )}
      <div className="token-combobox-live" role="status" aria-live="polite">
        {message || (open && text ? (openCount ? `${openCount} suggestion${openCount === 1 ? '' : 's'}` : `No ${noun}s match`) : '')}
      </div>
      {unknown.length > 0 && <small className="token-combobox-note">Not a known {noun}: {unknown.join(', ')}</small>}
    </div>
  );
}
