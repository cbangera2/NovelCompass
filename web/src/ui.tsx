import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Button({ className = '', variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}

export function Checkbox({ label, description, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; description?: string }) {
  return (
    <label className="ui-checkbox">
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
