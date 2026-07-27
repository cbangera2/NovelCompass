import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import React, { ButtonHTMLAttributes, cloneElement, InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, useId } from 'react';

export function Button({ className = '', variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}

export function Checkbox({ label, description, title, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; description?: string }) {
  return (
    <label className="ui-checkbox" title={title || description}>
      <input type="checkbox" {...props} />
      <span className="ui-checkbox-mark" aria-hidden="true" />
      <span className="ui-checkbox-label"><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </label>
  );
}

interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function extractOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  const processChild = (child: ReactNode) => {
    if (!child) return;
    if (Array.isArray(child)) {
      child.forEach(processChild);
      return;
    }
    if (React.isValidElement(child)) {
      if (child.type === 'option') {
        const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
        const value = props.value !== undefined ? String(props.value) : String(props.children || '');
        options.push({
          value,
          label: props.children ?? value,
          disabled: props.disabled,
        });
      } else if ((child.props as any)?.children) {
        processChild((child.props as any).children);
      }
    }
  };
  processChild(children);
  return options;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label?: string;
  value?: string | number;
  onValueChange?: (value: string) => void;
  onChange?: (event: { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }) => void;
  children?: ReactNode;
  className?: string;
}

export function Select({ label, value, defaultValue, onChange, onValueChange, disabled, className = '', children, name, id }: SelectProps) {
  const options = extractOptions(children);
  const stringValue = value !== undefined ? String(value) : (defaultValue !== undefined ? String(defaultValue) : undefined);

  const handleValueChange = (val: string | null) => {
    if (val === null) return;
    if (onValueChange) onValueChange(val);
    if (onChange) {
      const targetObj = { value: val, name };
      onChange({ target: targetObj, currentTarget: targetObj });
    }
  };

  return (
    <label className={`ui-select ${className}`.trim()}>
      {label && <span>{label}</span>}
      <BaseSelect.Root value={stringValue} onValueChange={handleValueChange} disabled={disabled} name={name} id={id}>
        <BaseSelect.Trigger className="ui-select-trigger">
          <BaseSelect.Value placeholder="Select..." />
          <BaseSelect.Icon className="ui-select-icon">
            <ChevronDown size={14} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={6} className="ui-select-positioner">
            <BaseSelect.Popup className="ui-select-popup">
              <BaseSelect.ScrollUpArrow />
              <BaseSelect.List className="ui-select-list">
                {options.map((opt) => (
                  <BaseSelect.Item key={opt.value} value={opt.value} disabled={opt.disabled} className="ui-select-item">
                    <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className="ui-select-item-indicator">
                      <Check size={14} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
              <BaseSelect.ScrollDownArrow />
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </label>
  );
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="ui-field-group"><legend>{label}</legend>{children}</fieldset>;
}

export function Tooltip({ content, children }: { content: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  return (
    <span className="ui-tooltip">
      {cloneElement(children, { 'aria-describedby': id })}
      <span className="ui-tooltip-content" id={id} role="tooltip">{content}</span>
    </span>
  );
}
