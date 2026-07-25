import { Dialog } from '@base-ui/react/dialog';
import { PanelLeft, X } from 'lucide-react';
import {
  Children, cloneElement, createContext, HTMLAttributes, isValidElement,
  ReactElement, ReactNode, useContext, useEffect, useState
} from 'react';
import './sidebar.css';

const STORAGE_KEY = 'novel-compass:sidebar-collapsed';

type SidebarContextValue = {
  collapsed: boolean;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) throw new Error('useSidebar must be used inside SidebarProvider');
  return value;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      setMobileOpen((value) => !value);
      return;
    }
    setCollapsed((value) => {
      localStorage.setItem(STORAGE_KEY, String(!value));
      return !value;
    });
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b' || event.altKey && event.code === 'Backslash') {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  return <SidebarContext.Provider value={{ collapsed, mobileOpen, setMobileOpen, toggleSidebar }}>
    <div className="sidebar-provider" data-collapsible={collapsed ? 'icon' : 'expanded'}>{children}</div>
  </SidebarContext.Provider>;
}

export function Sidebar({ children }: { children: ReactNode }) {
  const { mobileOpen, setMobileOpen } = useSidebar();
  return <>
    <aside className="sidebar-root" aria-label="Primary">{children}</aside>
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sidebar-mobile-backdrop" />
        <Dialog.Popup className="sidebar-mobile-sheet" aria-label="Navigation">
          <Dialog.Close className="sidebar-mobile-close" aria-label="Close navigation"><X size={18} /></Dialog.Close>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

export function SidebarHeader(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`sidebar-header ${props.className || ''}`} />; }
export function SidebarContent(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`sidebar-content ${props.className || ''}`} />; }
export function SidebarFooter(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`sidebar-footer ${props.className || ''}`} />; }
export function SidebarGroup(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`sidebar-group ${props.className || ''}`} />; }
export function SidebarGroupLabel(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`sidebar-group-label ${props.className || ''}`} />; }
export function SidebarMenu(props: HTMLAttributes<HTMLUListElement>) { return <ul {...props} className={`sidebar-menu ${props.className || ''}`} />; }
export function SidebarMenuItem(props: HTMLAttributes<HTMLLIElement>) { return <li {...props} className={`sidebar-menu-item ${props.className || ''}`} />; }

export function SidebarMenuButton({ asChild, active, tooltip, children, className = '' }: {
  asChild?: boolean; active?: boolean; tooltip?: string; children: ReactNode; className?: string;
}) {
  const { collapsed, setMobileOpen } = useSidebar();
  const common = {
    className: `sidebar-menu-button ${active ? 'active' : ''} ${className}`,
    'aria-current': active ? 'page' as const : undefined,
    title: collapsed ? tooltip : undefined,
    onClick: () => setMobileOpen(false)
  };
  if (asChild) {
    const child = Children.only(children);
    if (isValidElement(child)) return cloneElement(child as ReactElement<any>, { ...common, ...child.props, className: `${common.className} ${child.props.className || ''}` });
  }
  return <button type="button" {...common}>{children}</button>;
}

export function SidebarRail() {
  const { toggleSidebar, collapsed } = useSidebar();
  return <button className="sidebar-rail" onClick={toggleSidebar}
    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar · Ctrl/⌘ B`} />;
}

export function SidebarTrigger({ className = '' }: { className?: string }) {
  const { toggleSidebar, mobileOpen } = useSidebar();
  return <button className={`sidebar-trigger ${className}`} onClick={toggleSidebar}
    aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen}><PanelLeft size={18} /></button>;
}

export function SidebarInset(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`sidebar-inset ${props.className || ''}`} />;
}
