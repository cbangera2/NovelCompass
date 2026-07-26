import { ButtonHTMLAttributes, cloneElement, InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, useId } from 'react';

export function Button({ className = '', variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}

export function Checkbox({ label, description, title, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; description?: string }) {
  return (
    <label className="ui-checkbox" title={title || description}>
      <input type="checkbox" {...props} />
      <span className="ui-checkbox-mark" aria-hidden="true" />
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </label>
  );
}

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="ui-select">
      <span>{label}</span>
      <select {...props}>{children}</select>
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
