import { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import './design-system.css';

type ButtonVariant = 'default' | 'primary' | 'outline' | 'ghost';
type DSButtonProps =
  | (ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button'; variant?: ButtonVariant })
  | (AnchorHTMLAttributes<HTMLAnchorElement> & { as: 'a'; variant?: ButtonVariant });

export function DSButton({ variant = 'default', className = '', as = 'button', ...props }: DSButtonProps) {
  if (as === 'a') return <a className={`ds-button ds-button-${variant} ${className}`} {...props as AnchorHTMLAttributes<HTMLAnchorElement>} />;
  return <button className={`ds-button ds-button-${variant} ${className}`} {...props as ButtonHTMLAttributes<HTMLButtonElement>} />;
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ds-card ${className}`} {...props} />;
}
export function CardHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <header className="ds-card-header"><div>{eyebrow && <span>{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>;
}
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'violet' | 'green' | 'amber'; children: ReactNode }) {
  return <span className={`ds-badge ds-badge-${tone}`}>{children}</span>;
}
export function Separator() { return <hr className="ds-separator" />; }
export function Skeleton({ className = '' }: { className?: string }) { return <span className={`ds-skeleton ${className}`} aria-hidden="true" />; }
